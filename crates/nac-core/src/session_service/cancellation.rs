use super::*;

impl SessionService {
    /// Local host admission is independent of model selection and user permissions.
    pub fn check_host_execution_authority(&self) -> Result<()> {
        if let Some(authority) = &self.host_execution_authority {
            if let Err(error) = authority.check_available() {
                self.stopping_admission
                    .store(true, std::sync::atomic::Ordering::Release);
                return Err(error);
            }
        }
        Ok(())
    }

    /// Close admission and use existing cancellation/settlement after local denial.
    pub async fn settle_host_execution_denial(&self) -> Result<()> {
        if self.check_host_execution_authority().is_ok() {
            return Ok(());
        }
        self.stop_run_admission().await?;
        let run_id = match self.lock_active_operation().as_ref() {
            Some(ActiveSessionOperation::Run(run)) => Some(run.snapshot.run_id.clone()),
            _ => None,
        };
        if let Some(run_id) = run_id {
            match self.request_cancel(&run_id).await {
                Ok(_) | Err(SessionCancelError::NotActive { .. }) => {}
                Err(error) => return Err(anyhow::anyhow!(error)),
            }
        } else {
            self.terminal_manager.settle_run().await?;
        }
        Ok(())
    }

    pub async fn request_cancel(
        &self,
        run_id: &SessionRunId,
    ) -> std::result::Result<(), SessionCancelError> {
        // Cancellation owns terminal cleanup and several durable settlement
        // commits. Run it in an owned task so dropping an HTTP/tool caller can
        // never cancel the settlement future between those commits.
        let service = self.clone();
        let owned_run_id = run_id.clone();
        match tokio::spawn(async move { service.request_cancel_owned(&owned_run_id).await }).await {
            Ok(result) => result,
            Err(error) => Err(SessionCancelError::Cleanup {
                run_id: run_id.clone(),
                message: format!("cancellation settlement task failed: {error}"),
            }),
        }
    }

    async fn request_cancel_owned(
        &self,
        run_id: &SessionRunId,
    ) -> std::result::Result<(), SessionCancelError> {
        let id = run_id.clone();
        let prompt_commit = self
            .coordinate_local(move |service| service.run_prompt_commit(&id))
            .await
            .map_err(|error| SessionCancelError::Cleanup {
                run_id: run_id.clone(),
                message: format!("cancellation coordination failed: {error:#}"),
            })?;
        let Some(prompt_commit) = prompt_commit else {
            return Err(SessionCancelError::NotActive {
                run_id: run_id.clone(),
            });
        };
        let mut prompt_commit = prompt_commit.subscribe();
        loop {
            let status = *prompt_commit.borrow();
            match status {
                RunPromptCommitStatus::Pending => {
                    if prompt_commit.changed().await.is_err() {
                        return Err(SessionCancelError::NotActive {
                            run_id: run_id.clone(),
                        });
                    }
                }
                RunPromptCommitStatus::Committed => break,
                RunPromptCommitStatus::Failed => {
                    return Err(SessionCancelError::NotActive {
                        run_id: run_id.clone(),
                    });
                }
            }
        }
        let id = run_id.clone();
        let cancelling_run = self
            .coordinate_local(move |service| service.mark_run_cancelling(&id))
            .await
            .map_err(|error| SessionCancelError::Cleanup {
                run_id: run_id.clone(),
                message: format!("cancellation coordination failed: {error:#}"),
            })?;
        let Some(mut cancelling_run) = cancelling_run else {
            return Err(SessionCancelError::NotActive {
                run_id: run_id.clone(),
            });
        };

        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if crate::store::coordinator::owner_for(&self.metadata.store_path)
                .map(|owner| owner.is_some())
                .unwrap_or(true)
            {
                cancelling_run.command_cancellation.cancel_async().await;
            } else {
                cancelling_run.command_cancellation.cancel();
            }
            // Terminal handles are session-owned and can be idle while the
            // model is between tool calls. Start settlement immediately, then
            // repeat it after the run task has stopped. PTY spawn and input
            // share the cancellation token's final mutation gate, so neither
            // can cross this cancellation boundary after it wins.
            let _ = self.terminal_manager.settle_run().await;
        }

        let steering_store = self
            .metadata
            .session_id
            .as_deref()
            .map(|session_id| (self.metadata.store_path.as_path(), session_id));
        match self.active_threads.cancel_and_drain(steering_store).await {
            Ok(records) => self.emit_steering_expired_async(records).await,
            Err(error) => eprintln!("nac: failed to expire cancelled worker steering: {error:#}"),
        }

        if let Some(task) = cancelling_run.task.as_mut() {
            let abort = self.metadata.behavior == sessions::SessionBehavior::Orchestrator
                || tokio::time::timeout(Duration::from_secs(2), &mut *task)
                    .await
                    .is_err();
            if abort {
                task.abort();
                let _ = (&mut *task).await;
            }
        }

        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.terminal_manager.settle_run().await {
                // Cleanup is a terminal-state admission boundary. Keep the run,
                // its operation lease, goal/child bindings, and queued inbox
                // successor unsettled so a later cancellation can retry.
                return Err(SessionCancelError::Cleanup {
                    run_id: cancelling_run.snapshot.run_id.clone(),
                    message: format!("{error:#}"),
                });
            }
        }

        self.expire_orchestrator_steering(&cancelling_run.snapshot.run_id)
            .await;

        // A cancellation marker is itself a visible response. If the run task
        // was cancelled before capturing its baseline, record the count before
        // appending that marker so partial cancellation usage still lands on it.
        let transcript_baseline = match cancelling_run.transcript_baseline {
            Some(baseline) => Some(baseline),
            None => {
                if let Err(error) = self.update_transcript_scan().await {
                    eprintln!(
                        "nac: failed to capture transcript baseline for cancellation: {error:#}"
                    );
                }
                Some(self.lock_transcript_scan().visible_response_count)
            }
        };

        // Capture partial token usage from the cancelled run, including a
        // committed compaction projection when cancellation happened before
        // the following ordinary call completed.
        let cancel_usage = self.append_cancellation_message().await;

        let persistence_error = match self
            .persist_run_snapshot(
                &cancelling_run.snapshot,
                transcript_baseline,
                None,
                cancel_usage.clone(),
                DurableRunTerminal::Cancelled,
                None,
            )
            .await
        {
            Ok(()) => None,
            Err(error) => {
                eprintln!(
                    "nac: failed to persist cancellation snapshot for run {}: {error:#}",
                    cancelling_run.snapshot.run_id
                );
                Some(format!("{error:#}"))
            }
        };

        // Persistence is bookkeeping after the cancellation boundary. A store
        // fault is still diagnosed above, but it cannot rewrite the user's
        // requested outcome into a run failure.
        if let Some(error) = persistence_error {
            eprintln!(
                "nac: run {} remains cancelled despite snapshot persistence failure: {error}",
                cancelling_run.snapshot.run_id
            );
        }
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            self.settle_direct_goal_run(
                &cancelling_run.snapshot.run_id,
                cancel_usage,
                crate::store::GoalRunDisposition::Cancelled,
                None,
            )
            .await;
            self.capture_workspace_revision(&cancelling_run.snapshot)
                .await;
            self.settle_traditional_child_run(
                &cancelling_run.snapshot.run_id,
                crate::store::TraditionalChildStatus::Cancelled,
                None,
                Some("parent or user cancelled the child run".to_string()),
            )
            .await;
        }
        if let Err(error) = self
            .event_bus
            .emit_with_context_async(
                SessionEvent::RunCancelled,
                Some(cancelling_run.snapshot.run_id.clone()),
                cancelling_run.snapshot.client_id.clone(),
            )
            .await
        {
            eprintln!("nac: cancellation event caller failed: {error:#}");
        }
        let id = cancelling_run.snapshot.run_id.clone();
        self.coordinate_local(move |service| service.clear_finished_run(&id))
            .await
            .map_err(|error| SessionCancelError::Cleanup {
                run_id: cancelling_run.snapshot.run_id.clone(),
                message: format!("cancellation cleanup failed: {error:#}"),
            })?;
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.start_next_direct_inbox_item().await {
                eprintln!("nac: failed to promote direct inbox after cancellation: {error:#}");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod host_execution_tests {
    use super::*;
    use crate::model::host_execution_test_support::Fixture;

    #[tokio::test]
    async fn host_execution_denial_fences_admission_in_all_session_behaviors() {
        for behavior in [
            sessions::SessionBehavior::Orchestrator,
            sessions::SessionBehavior::Direct,
            sessions::SessionBehavior::DirectWithOrchestrator,
        ] {
            let fixture = Fixture::new();
            let client = crate::model::ModelClient::new_for_test()
                .with_host_execution_authority(Some(fixture.authority.clone()))
                .unwrap();
            let (mut parts, path) = super::super::tests::test_active_service_with_skills(
                "host-execution-admission",
                &uuid::Uuid::new_v4().to_string(),
                client,
                None,
            );
            Arc::make_mut(&mut parts.service.metadata).behavior = behavior;
            let session = parts.service.metadata.session_id.as_deref().unwrap();
            let queued = crate::store::create_session_inbox_item(
                &path,
                session,
                crate::store::InboxDelivery::Queue,
                "retained input",
                None,
                None,
            )
            .unwrap();
            fixture.remove();
            assert!(matches!(
                parts.service.try_submit_prompt("denied prompt".into()),
                Err(SessionSubmitError::Coordination { .. })
            ));
            parts.service.settle_host_execution_denial().await.unwrap();
            fixture.restore();
            assert!(parts
                .service
                .try_submit_prompt("still denied".into())
                .is_err());
            assert!(parts.service.lock_active_operation().is_none());
            let pending = crate::store::list_session_inbox(&path, session).unwrap();
            assert!(pending.iter().any(|record| record.id == queued.id));
        }
    }

    #[tokio::test]
    async fn host_execution_denial_rejects_new_direct_input_without_changing_pending_rows() {
        let fixture = Fixture::new();
        let client = crate::model::ModelClient::new_for_test()
            .with_host_execution_authority(Some(fixture.authority.clone()))
            .unwrap();
        let (parts, path) = super::super::tests::test_direct_active_service(
            "host-execution-inbox",
            &uuid::Uuid::new_v4().to_string(),
            client,
        );
        fixture.remove();
        assert!(parts
            .service
            .enqueue_direct_input(crate::store::InboxDelivery::Queue, "denied input", None)
            .await
            .is_err());
        let session = parts.service.metadata.session_id.as_deref().unwrap();
        assert!(crate::store::list_session_inbox(&path, session)
            .unwrap()
            .is_empty());
    }
}
