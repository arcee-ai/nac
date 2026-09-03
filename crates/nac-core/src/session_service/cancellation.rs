use super::*;

impl SessionService {
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
        let Some(prompt_commit) = self.run_prompt_commit(run_id) else {
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
        let Some(mut cancelling_run) = self.mark_run_cancelling(run_id) else {
            return Err(SessionCancelError::NotActive {
                run_id: run_id.clone(),
            });
        };

        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            cancelling_run.command_cancellation.cancel();
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
            Ok(records) => self.emit_steering_expired(records),
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

        self.expire_orchestrator_steering(&cancelling_run.snapshot.run_id);

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
            )
            .await;
            self.capture_workspace_revision(&cancelling_run.snapshot)
                .await;
            self.settle_traditional_child_run(
                &cancelling_run.snapshot.run_id,
                crate::store::TraditionalChildStatus::Cancelled,
                None,
                Some("parent or user cancelled the child run".to_string()),
            );
        }
        self.event_bus.emit_with_context(
            SessionEvent::RunCancelled,
            Some(cancelling_run.snapshot.run_id.clone()),
            cancelling_run.snapshot.client_id.clone(),
        );
        self.clear_finished_run(&cancelling_run.snapshot.run_id);
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.start_next_direct_inbox_item().await {
                eprintln!("nac: failed to promote direct inbox after cancellation: {error:#}");
            }
        }
        Ok(())
    }
}
