//! Durable decisions for traditional-child continuation.
//!
//! A relationship settlement and its completion receipt commit together. An
//! executor error can nevertheless arrive after that transaction committed, so
//! recovery must resolve the exact generation before issuing any later work.
use super::*;
use crate::store::{TraditionalChildRecord, TraditionalChildStatus, TraditionalChildTerminal};

#[cfg(feature = "managed-fault-fixture")]
#[derive(Debug)]
pub(super) struct InjectedChildReadFailure;

#[cfg(feature = "managed-fault-fixture")]
impl std::fmt::Display for InjectedChildReadFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("private fixture injected traditional child settlement read failure")
    }
}
#[cfg(feature = "managed-fault-fixture")]
impl std::error::Error for InjectedChildReadFailure {}

#[derive(Debug)]
pub(super) struct ChildSettlementMismatch {
    pub(super) generation: u64,
}

impl std::fmt::Display for ChildSettlementMismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "child settlement run does not match generation {}",
            self.generation
        )
    }
}
impl std::error::Error for ChildSettlementMismatch {}

/// Register a manager-owned wake before releasing recovery. External
/// controllers predating the internal port retain the original detached wake.
pub(super) fn retain_wake(
    controller: Arc<dyn crate::traditional_children::TraditionalChildController>,
    session_id: &str,
    recovery: bool,
) -> Result<()> {
    let retained = if recovery {
        controller.retain_recovery(session_id)
    } else {
        controller.retain_wake(session_id)
    };
    if let Some(result) = retained {
        return result;
    }
    let session_id = session_id.to_owned();
    tokio::spawn(async move {
        if let Err(error) = controller.wake(&session_id).await {
            eprintln!("nac: failed to wake session after child settlement: {error:#}");
        }
    });
    Ok(())
}

/// The durable settlement, including an existing receipt after lost response.
/// Returning the record lets the lifecycle owner schedule a coalesced parent
/// wake independently of whether this invocation performed the transaction.
pub(super) fn settle_generation(
    service: &SessionService,
    run_id: &SessionRunId,
    status: TraditionalChildStatus,
    report: Option<String>,
    failure: Option<String>,
) -> Result<Option<TraditionalChildRecord>> {
    let Some(session_id) = service.metadata.session_id.as_deref() else {
        return Ok(None);
    };
    let Some(child) =
        crate::store::load_traditional_child(&service.metadata.store_path, session_id)?
    else {
        return Ok(None);
    };
    #[cfg(feature = "managed-fault-fixture")]
    if child.run_id.as_deref() == Some(run_id.as_str())
        && crate::managed_fault_fixture::hit(
            crate::managed_fault_fixture::Boundary::ChildRead,
            session_id,
            Some(run_id.as_str()),
            Some(child.generation),
        )?
    {
        eprintln!("nac: private fixture injected traditional child settlement read failure");
        return Err(InjectedChildReadFailure.into());
    }

    // A successor may already have advanced the mutable relationship. Resolve
    // this exact run through its immutable receipt rather than settling the new
    // generation or assuming that a terminal current row identifies this run.
    let receipt = || {
        crate::store::load_traditional_child_terminal_receipt_for_run(
            &service.metadata.store_path,
            session_id,
            run_id.as_str(),
        )
        .and_then(|receipt| {
            if let Some(record) = &receipt {
                anyhow::ensure!(
                    record.parent_session_id == child.parent_session_id,
                    "child settlement receipt belongs to another parent"
                );
                if let Some(item_id) = record.completion_inbox_id {
                    let item = crate::store::load_session_inbox_item(
                        &service.metadata.store_path,
                        &record.parent_session_id,
                        item_id,
                    )?;
                    match item.internal_completion {
                        Some(origin) => anyhow::ensure!(
                            origin.source
                                == crate::store::InternalCompletionSource::TraditionalChild
                                && origin.relationship_session_id == session_id
                                && origin.generation == record.generation,
                            "child settlement completion identity does not match its receipt"
                        ),
                        // Older migrations backfill provenance only for pending
                        // completions. A closed legacy row needs no new wake.
                        None => anyhow::ensure!(
                            item.status != crate::store::InboxStatus::Pending,
                            "pending child completion has no durable origin"
                        ),
                    }
                }
            }
            Ok(receipt)
        })
    };
    if let Some(record) = receipt()? {
        return Ok(Some(record));
    }
    if child.run_id.as_deref() != Some(run_id.as_str()) {
        return Err(ChildSettlementMismatch {
            generation: child.generation,
        }
        .into());
    }
    let revision = match crate::store::workspace_revision_for_run(
        &service.metadata.store_path,
        session_id,
        run_id.as_str(),
    ) {
        Ok(revision) => revision,
        Err(error)
            if error
                .downcast_ref::<crate::store::PersistenceAdmissionError>()
                .is_some() =>
        {
            return Err(error);
        }
        Err(error) => {
            eprintln!("nac: failed to read child workspace revision: {error:#}");
            None
        }
    };
    let change_summary = revision.map(|revision| {
        format!(
            "{} files changed, +{} -{}",
            revision.changed_files, revision.additions, revision.deletions
        )
    });
    let verification_summary = report
        .as_deref()
        .and_then(|report| extract_report_section(report, "verification"));
    let outcome = crate::store::settle_traditional_child_run(
        &service.metadata.store_path,
        session_id,
        run_id.as_str(),
        TraditionalChildTerminal {
            status,
            report,
            failure,
            change_summary,
            verification_summary,
        },
    );
    resolve_settlement(outcome, receipt)
}

fn resolve_settlement(
    outcome: Result<crate::store::TraditionalChildSettlement>,
    receipt: impl FnOnce() -> Result<Option<TraditionalChildRecord>>,
) -> Result<Option<TraditionalChildRecord>> {
    match outcome {
        Ok(settlement) => Ok(Some(settlement.child)),
        Err(error) => {
            // Only an exact immutable receipt can resolve a lost response. A
            // missing or unavailable receipt never proves that retry is safe.
            match receipt() {
                Ok(Some(record)) => Ok(Some(record)),
                Ok(None) | Err(_) => Err(error),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ModelClient;
    use crate::session_service::tests::test_direct_active_service;
    use crate::store::{TraditionalChildExecutionMode, TraditionalChildStatus};

    #[tokio::test]
    async fn settled_receipt_survives_successor_and_never_inserts_a_second_completion() {
        let (parts, path) = test_direct_active_service(
            "child_settlement_replay",
            "child",
            ModelClient::new_for_test(),
        );
        let mut parent = sessions::load_session(&path, "child").unwrap();
        parent.session_id = "parent".into();
        sessions::create_session(&path, &parent).unwrap();
        crate::store::create_traditional_child_relationship(
            &path,
            "parent",
            "child",
            "general",
            "settlement replay",
        )
        .unwrap();
        let original = crate::store::begin_traditional_child_run(
            &path,
            "child",
            "run-one",
            TraditionalChildExecutionMode::Background,
        )
        .unwrap();
        let run = SessionRunId::from_stored("run-one".into());
        let first = settle_generation(
            &parts.service,
            &run,
            TraditionalChildStatus::Completed,
            Some("done".into()),
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(first.generation, original.generation);
        let completion = first.completion_inbox_id.unwrap();
        // Simulate losing the response after the real settlement transaction.
        // Reconciliation must use this generation's immutable receipt.
        let resolved = resolve_settlement(
            Err(crate::store::PersistenceAdmissionError::ExecutorStopped.into()),
            || {
                crate::store::load_traditional_child_terminal_receipt(
                    &path,
                    "child",
                    original.generation,
                )
            },
        )
        .unwrap()
        .unwrap();
        assert_eq!(resolved.run_id.as_deref(), Some("run-one"));
        assert_eq!(resolved.completion_inbox_id, Some(completion));
        let rejected = resolve_settlement(
            Err(crate::store::PersistenceAdmissionError::ExecutorStopped.into()),
            || Ok(None),
        )
        .unwrap_err();
        assert_eq!(
            rejected.downcast_ref::<crate::store::PersistenceAdmissionError>(),
            Some(&crate::store::PersistenceAdmissionError::ExecutorStopped)
        );
        crate::store::begin_traditional_child_run(
            &path,
            "child",
            "run-two",
            TraditionalChildExecutionMode::Foreground,
        )
        .unwrap();
        let replay = settle_generation(
            &parts.service,
            &run,
            TraditionalChildStatus::Completed,
            Some("done".into()),
            None,
        )
        .unwrap()
        .unwrap();
        assert_eq!(replay.generation, original.generation);
        assert_eq!(replay.completion_inbox_id, Some(completion));
        let items = crate::store::list_session_inbox(&path, "parent").unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, completion);
        let current = crate::store::load_traditional_child(&path, "child")
            .unwrap()
            .unwrap();
        assert_eq!(current.run_id.as_deref(), Some("run-two"));
        assert_eq!(current.status, TraditionalChildStatus::Running);
        let missing = SessionRunId::from_stored("unknown-run".into());
        assert!(settle_generation(
            &parts.service,
            &missing,
            TraditionalChildStatus::Failed,
            None,
            None,
        )
        .is_err());
    }
}
