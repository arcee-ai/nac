//! Fresh destinations share the parent scheduler's occurrence scan and limits.
use super::*;
use crate::application::task_launches::TaskLaunchApplication;
use nac_core::store::{FreshTaskPreparationPort, HeartbeatOutcome, PreparedFreshTaskLaunch};

pub(super) async fn admit(
    manager: &SessionManager,
    occurrence: &HeartbeatOccurrence,
    lifetime: &SchedulerLifetime,
) -> Result<bool> {
    let path = manager.inner.store_path.clone();
    let id = occurrence.occurrence_id.clone();
    let revision = occurrence.revision;
    let Some(reservation) = lifetime.begin(manager, || {
        store::spawn_blocking_store_caller(move || {
            store::reserve_fresh_heartbeat_launch(&path, &id, revision, epoch_ms())
        })
    }) else {
        return Ok(false);
    };
    let Some(prepared) = reservation.await?? else {
        return Ok(false);
    };
    prepare(manager, prepared, lifetime).await?;
    Ok(true)
}

async fn failure(
    manager: &SessionManager,
    id: String,
    outcome: HeartbeatOutcome,
    reason: &'static str,
    lifetime: &SchedulerLifetime,
) -> Result<()> {
    let path = manager.inner.store_path.clone();
    let Some(record) = lifetime.begin(manager, || {
        store::spawn_blocking_store_caller(move || {
            store::fail_fresh_heartbeat_before_run(&path, &id, outcome, reason, epoch_ms())
        })
    }) else {
        return Ok(());
    };
    record.await?
}

async fn prepare(
    manager: &SessionManager,
    prepared: PreparedFreshTaskLaunch,
    lifetime: &SchedulerLifetime,
) -> Result<()> {
    let id = prepared.receipt().occurrence_id.clone();
    let application = TaskLaunchApplication::new(manager);
    // The accepted port operation retains TaskPreparations' existing reader.
    // Await it even when Stop closes this scheduler; no later phase may start.
    let Some(preparation) = lifetime.begin(manager, || application.prepare(prepared)) else {
        return Ok(());
    };
    if let Err(error) = preparation.await {
        let outcome = if error.is::<nac_core::permissions::ScheduledProjectAdmissionRequired>() {
            HeartbeatOutcome::NeedsHumanAction
        } else {
            HeartbeatOutcome::Failed
        };
        failure(manager,id,outcome,"Scheduled task preparation failed. Inspect its retained launch/workspace inventory; no fallback or new initial input was created.",lifetime).await?;
        eprintln!("nac: scheduled preparation failed: {error:#}");
    }
    Ok(())
}

pub(super) async fn reconcile(
    manager: &SessionManager,
    occurrence: &HeartbeatOccurrence,
    lifetime: &SchedulerLifetime,
) -> Result<bool> {
    let path = manager.inner.store_path.clone();
    let id = occurrence.occurrence_id.clone();
    let Some(read) = lifetime.begin(manager, || {
        store::spawn_blocking_store_caller(move || store::read_fresh_heartbeat_launch(&path, &id))
    }) else {
        return Ok(true);
    };
    let Some(prepared) = read.await?? else {
        return Ok(false);
    };
    if lifetime.is_closed(manager) {
        return Ok(true);
    }
    let receipt = prepared.receipt();
    if receipt.initial_outcome.is_some() {
        return Ok(true);
    }
    if receipt.stop_requested {
        let path = manager.inner.store_path.clone();
        let request = receipt.request.request_id.clone();
        let Some(cancel) = lifetime.begin(manager, || {
            store::spawn_blocking_store_caller(move || -> Result<()> {
                if store::load_task_launch(&path, &request)?.is_some() {
                    store::update_task_launch(
                        &path,
                        &request,
                        store::TaskLaunchPhase::Cancelled,
                        None,
                    )?;
                }
                Ok(())
            })
        }) else {
            return Ok(true);
        };
        cancel.await??;
        if occurrence.run_id.is_none() {
            failure(manager,receipt.occurrence_id.clone(),HeartbeatOutcome::Interrupted,"The schedule stopped its exact unstarted initial occurrence; retained files remain owned.",lifetime).await?;
            return Ok(true);
        }
    }
    let session = receipt.session_id.clone();
    let cached = manager
        .inner
        .active_sessions
        .read()
        .await
        .get(&session)
        .cloned();
    if lifetime.is_closed(manager) {
        return Ok(true);
    }
    if let Some(service) = cached
        .as_ref()
        .filter(|service| service.has_active_operation())
    {
        if receipt.stop_requested {
            if let Some(run) = &occurrence.run_id {
                let run: nac_core::events::SessionRunId =
                    serde_json::from_value(serde_json::Value::String(run.clone()))?;
                if let Some(cancel) = lifetime.begin(manager, || service.request_cancel(&run)) {
                    let _ = cancel.await;
                };
            }
        }
        return Ok(true);
    }
    if occurrence.run_id.is_some() {
        let gate = manager.lifecycle_gate(&session);
        let Ok(_lifecycle) = gate.try_lock() else {
            return Ok(true);
        };
        let Some(_lease) = lease(manager, &session, lifetime).await? else {
            return Ok(true);
        };
        let path = manager.inner.store_path.clone();
        let Some(reconcile) = lifetime.begin(manager, || {
            store::spawn_blocking_store_caller(move || {
                store::reconcile_heartbeat_occurrences(&path, &session, epoch_ms())
            })
        }) else {
            return Ok(true);
        };
        reconcile.await??;
        return Ok(true);
    }
    if receipt.first_input_id.is_none() {
        prepare(manager, prepared, lifetime).await?;
        return Ok(true);
    }
    let path = manager.inner.store_path.clone();
    let target = session.clone();
    let Some(present) = lifetime.begin(manager, || {
        store::spawn_blocking_store_caller(move || sessions::load_session_config(&path, &target))
    }) else {
        return Ok(true);
    };
    let present = present.await?;
    if present.is_err() {
        failure(manager,receipt.occurrence_id.clone(),HeartbeatOutcome::NeedsHumanAction,"The produced task was deleted or is unavailable. Its initial input and retained workspace will not be recreated.",lifetime).await?;
        return Ok(true);
    }
    let gate = manager.lifecycle_gate(&session);
    let Ok(_lifecycle) = gate.try_lock() else {
        return Ok(true);
    };
    let Some(lease) = lease(manager, &session, lifetime).await? else {
        return Ok(true);
    };
    let application = HeartbeatApplication::new(manager);
    let Some(attachment) =
        lifetime.begin(manager, || application.scheduler_service(&session, &lease))
    else {
        return Ok(true);
    };
    let service = match attachment.await {
        Ok(service) => service,
        Err(error) if error.is::<nac_core::model::ModelConfigurationError>() => {
            failure(
                manager,
                receipt.occurrence_id.clone(),
                HeartbeatOutcome::NeedsHumanAction,
                "The scheduled initial runtime is unavailable. Review its configuration and credentials; its exact input and retained workspace were not recreated.",
                lifetime,
            )
            .await?;
            eprintln!("nac: scheduled initial attachment requires review: {error:#}");
            return Ok(true);
        }
        Err(error) => return Err(error),
    };
    if !lifetime.begin_submission(manager, &service) {
        service.stop_run_admission().await?;
        return Ok(true);
    }
    #[cfg(test)]
    tests::hold_submission(&manager.inner.store_path, &service).await;
    let result = service
        .start_fresh_heartbeat_initial_input(occurrence.clone(), lease)
        .await;
    lifetime.finish_submission();
    if let Err(error) = result {
        failure(manager,receipt.occurrence_id.clone(),HeartbeatOutcome::NeedsHumanAction,"The scheduled initial run requires human review; its exact input was retained without automatic replay.",lifetime).await?;
        eprintln!("nac: scheduled initial admission requires review: {error:#}");
    }
    Ok(true)
}
