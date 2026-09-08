use super::*;

impl SessionService {
    pub(super) fn prepare_operation_admission(
        &self,
        supplied_lease: Option<sessions::SessionOperationLease>,
    ) -> std::result::Result<
        Option<sessions::SessionOperationLease>,
        OperationAdmissionPreparationError,
    > {
        let operation_lease = match (supplied_lease, self.metadata.session_id.as_deref()) {
            (Some(lease), Some(session_id)) => {
                lease
                    .validate(&self.metadata.store_path, session_id)
                    .map_err(|error| match error {
                        sessions::SessionOperationLeaseValidationError::IdentityMismatch => {
                            OperationAdmissionPreparationError::Coordination {
                                message: SessionCoordinationError::invalid_lease(),
                            }
                        }
                        sessions::SessionOperationLeaseValidationError::Store(error) => {
                            OperationAdmissionPreparationError::Coordination {
                                message: SessionCoordinationError::store(format!(
                                    "failed to validate session operation lease: {error:#}"
                                )),
                            }
                        }
                    })?;
                Some(lease)
            }
            (Some(_), None) => {
                return Err(OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::invalid_lease(),
                });
            }
            (None, Some(session_id)) => Some(
                sessions::SessionOperationLease::try_acquire(&self.metadata.store_path, session_id)
                    .map_err(|error| match error {
                        sessions::SessionOperationLeaseError::Busy(session_id) => {
                            OperationAdmissionPreparationError::ExternalBusy { session_id }
                        }
                        sessions::SessionOperationLeaseError::Store(error) => {
                            OperationAdmissionPreparationError::Coordination {
                                message: SessionCoordinationError::store(format!(
                                    "session operation coordination failed: {error:#}"
                                )),
                            }
                        }
                    })?,
            ),
            // Picker services have no runnable persisted session. Keeping this
            // path lease-free supports read-only picker construction.
            (None, None) => None,
        };

        if let (Some(session_id), Some(service_version)) =
            (self.metadata.session_id.as_deref(), self.config_version)
        {
            let persisted_version =
                sessions::load_session_config(&self.metadata.store_path, session_id)
                    .map_err(|error| OperationAdmissionPreparationError::Coordination {
                        message: SessionCoordinationError::store(format!(
                            "failed to verify session configuration revision: {error:#}"
                        )),
                    })?
                    .config_version;
            if persisted_version != service_version {
                return Err(OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::stale_configuration(session_id),
                });
            }
        }

        // The caller holds the local operation-state lock and the lease above
        // excludes other processes. Refresh before publishing active state so
        // every run and manual compaction starts from the newest valid durable
        // state, including direct callers.
        //
        // The transcript refresh is load-bearing for shared-store recovery
        // (issue #146): this long-lived service can survive the peer process
        // that owned the previous run. The OS releases the peer's lease on
        // its death, but the cached agent's in-memory transcript still
        // predates the peer's committed rows — a run started from it would
        // append at a stale index (rejected by the log's contiguity guard)
        // and terminal normalization would delete the peer's committed rows
        // from the stale length. Re-restoring under the lease is race-free.
        if let Some(lease) = operation_lease.as_ref() {
            let mut agent = self.agent.try_lock().map_err(|_| {
                OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::local_agent_busy(),
                }
            })?;
            let durable_blob = agent
                .refresh_transcript_under_lease(lease)
                .map_err(|error| OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to refresh the transcript under the operation lease: {error:#}"
                    )),
                })?;
            agent.restore_compaction_checkpoint().map_err(|error| {
                OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to reload compaction checkpoint: {error:#}"
                    )),
                }
            })?;
            drop(agent);
            if let (Some(session_id), Some(durable_blob)) =
                (self.metadata.session_id.as_deref(), durable_blob)
            {
                // Reconcile every run-state field that the next completion
                // persists, not only the transcript blob. A peer may have
                // committed token and timing history before releasing the
                // lease; retaining the stale cached values would make this
                // process overwrite that history at its next run end.
                //
                // Load after transcript repair so `durable_blob` and the
                // persisted run state describe the same lease-held store
                // state. Keep cached identity/configuration fields: cwd is
                // runtime-canonicalized, and the config revision was checked
                // above.
                let (durable_run_state, durable_updated_at) =
                    sessions::load_session_run_state(&self.metadata.store_path, session_id)
                        .map_err(|error| OperationAdmissionPreparationError::Coordination {
                            message: SessionCoordinationError::store(format!(
                                "failed to refresh durable session run state: {error:#}"
                            )),
                        })?;
                let mut snapshot = self.session_snapshot.try_lock().map_err(|_| {
                    OperationAdmissionPreparationError::Coordination {
                        message: SessionCoordinationError::local_agent_busy(),
                    }
                })?;
                if let Some(snapshot) = snapshot.as_mut() {
                    snapshot.messages = durable_blob;
                    snapshot.last_response_duration_ms =
                        durable_run_state.last_response_duration_ms;
                    snapshot.previous_response_duration_ms =
                        durable_run_state.previous_response_duration_ms;
                    snapshot.response_durations_ms = durable_run_state.response_durations_ms;
                    snapshot.token_usages = durable_run_state.token_usages;
                    snapshot.unattributed_token_usage = durable_run_state.unattributed_token_usage;
                    snapshot.updated_at = durable_updated_at;
                }
            }
        }

        Ok(operation_lease)
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    pub fn try_submit_prompt(
        &self,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(None, expanded_prompt, None, RunAdmissionKind::default())
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    pub fn try_submit_prompt_for_client(
        &self,
        client_id: SessionClientId,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(
            Some(client_id),
            expanded_prompt,
            None,
            RunAdmissionKind::default(),
        )
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    pub fn try_submit_prompt_for_client_with_lease(
        &self,
        client_id: SessionClientId,
        expanded_prompt: String,
        lease: sessions::SessionOperationLease,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(
            Some(client_id),
            expanded_prompt,
            Some(lease),
            RunAdmissionKind::default(),
        )
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    pub fn try_submit_traditional_child_prompt(
        &self,
        expanded_prompt: String,
        execution_mode: crate::store::TraditionalChildExecutionMode,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(
            None,
            expanded_prompt,
            None,
            RunAdmissionKind {
                child_execution_mode: Some(execution_mode),
                ..RunAdmissionKind::default()
            },
        )
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    #[expect(
        clippy::expect_used,
        reason = "successful run admission installs the prompt-commit channel before returning"
    )]
    pub(super) fn try_submit_prompt_inner(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: String,
        operation_lease: Option<sessions::SessionOperationLease>,
        admission: RunAdmissionKind,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        let active_run =
            self.try_begin_run_with_lease(client_id, &expanded_prompt, operation_lease, admission)?;
        let run_id = active_run.run_id.clone();
        let task_run_id = run_id.clone();
        let run_client_id = active_run.client_id.clone();
        let prompt_commit = self
            .run_prompt_commit(&run_id)
            .expect("newly admitted run must own its prompt commit channel");
        let inbox_item_id = self.run_inbox_item_id(&run_id);
        let event_bus = self.event_bus.clone();
        let service = self.clone();
        let task = tokio::spawn(async move {
            // Step 4 (never-fold): capture the run-start visible-response
            // count from the store transcript BEFORE this run's first
            // append. It is the diff base for the run-end token/timing
            // bookkeeping, which no longer has an old-vs-new messages vec
            // to diff. Best-effort: the run-end persist falls back to the
            // run-end count when this fails.
            if let Err(error) = service.update_transcript_scan().await {
                eprintln!(
                    "nac: failed to capture the transcript baseline for run {task_run_id}: {error:#}"
                );
            }
            let baseline = service.lock_transcript_scan().visible_response_count;
            service.set_run_transcript_baseline(&task_run_id, baseline);
            let (result, usage) = {
                let mut agent = service.agent.lock().await;
                agent.set_event_sink(EventSink::bus_with_context(
                    event_bus.clone(),
                    Some(task_run_id.clone()),
                    run_client_id.clone(),
                ));
                agent.set_steering_dispatch_id(Some(task_run_id.to_string()));
                let result = agent
                    .send_session_run(&expanded_prompt, &task_run_id, prompt_commit, inbox_item_id)
                    .await
                    .map_err(|error| error.to_string());
                agent.set_event_sink(EventSink::bus(event_bus));
                // Capture usage regardless of success or failure. On error
                // paths, `last_usage` is now set in `send()` before returning
                // Err, so worker thread tokens from prior tool rounds survive.
                let usage = agent.last_usage.clone();
                (result, usage)
            };
            match result {
                Ok(response) => {
                    service
                        .finish_run(&task_run_id, RunOutcome::Completed(response, usage))
                        .await;
                }
                Err(message) => {
                    // The published event is deliberately reduced to "run
                    // failed", so the operator's log is the only place the real
                    // reason can be read.
                    eprintln!("nac: run failed: {message}");
                    service
                        .finish_run(&task_run_id, RunOutcome::Failed(message, usage))
                        .await;
                }
            }
        });
        self.set_run_task(&run_id, task);

        Ok(SessionRunHandle {
            run_id: active_run.run_id,
            client_id: active_run.client_id,
        })
    }

    #[cfg(test)]
    pub(super) fn try_begin_run(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        let active = self.try_begin_run_inner(
            client_id,
            expanded_prompt,
            None,
            false,
            RunAdmissionKind::default(),
        )?;
        self.run_prompt_commit(&active.run_id)
            .expect("test run admission must own a prompt commit channel")
            .send_replace(RunPromptCommitStatus::Committed);
        Ok(active)
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    pub(super) fn try_begin_run_with_lease(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
        supplied_lease: Option<sessions::SessionOperationLease>,
        admission: RunAdmissionKind,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        self.try_begin_run_inner(client_id, expanded_prompt, supplied_lease, true, admission)
    }

    #[expect(
        clippy::result_large_err,
        reason = "admission errors carry the complete active-operation conflict snapshot"
    )]
    pub(super) fn try_begin_run_inner(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
        supplied_lease: Option<sessions::SessionOperationLease>,
        enforce_coordination: bool,
        admission: RunAdmissionKind,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        let RunAdmissionKind {
            inbox_item_id,
            goal_continuation,
            child_execution_mode,
            managed_orchestrator_execution_mode,
        } = admission;
        let mut guard = self.lock_active_operation();
        match guard.as_ref() {
            Some(ActiveSessionOperation::Run(active_run)) => {
                return Err(SessionSubmitError::Busy {
                    active_run: active_run.snapshot.clone(),
                });
            }
            Some(ActiveSessionOperation::ManualCompaction(active)) => {
                return Err(SessionSubmitError::ExternalBusy {
                    session_id: SessionOperationBusy::Local {
                        session_id: self
                            .metadata
                            .session_id
                            .clone()
                            .unwrap_or_else(|| "unavailable".to_string()),
                        active_operation: ActiveSessionOperationSnapshot::ManualCompaction {
                            compaction: active.snapshot.clone(),
                        },
                    },
                });
            }
            None => {}
        }

        let operation_lease = if enforce_coordination {
            self.prepare_operation_admission(supplied_lease)
                .map_err(|error| match error {
                    OperationAdmissionPreparationError::ExternalBusy { session_id } => {
                        SessionSubmitError::ExternalBusy {
                            session_id: SessionOperationBusy::External { session_id },
                        }
                    }
                    OperationAdmissionPreparationError::Coordination { message } => {
                        SessionSubmitError::Coordination { message }
                    }
                })?
        } else {
            None
        };
        let workspace_activity_lease = if enforce_coordination {
            self.terminal_manager
                .acquire_workspace_activity_lease()
                .map_err(|error| SessionSubmitError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to acquire workspace run authority: {error:#}"
                    )),
                })?
        } else {
            None
        };

        if enforce_coordination {
            if let Some(session_id) = self.metadata.session_id.as_deref() {
                let recovery =
                    crate::store::reconcile_active_run(&self.metadata.store_path, session_id)
                        .map_err(|error| SessionSubmitError::Coordination {
                            message: SessionCoordinationError::store(format!(
                                "failed to reconcile interrupted run state: {error:#}"
                            )),
                        })?;
                if let crate::store::ActiveRunReconciliation::Interrupted { run_id } = recovery {
                    self.event_bus.emit_with_context(
                        SessionEvent::RunFailed {
                            message: INTERRUPTED_RUN_EVENT_MESSAGE.to_string(),
                        },
                        Some(SessionRunId::from_stored(run_id)),
                        None,
                    );
                }
                let mut expired =
                    crate::store::expire_session_steering(&self.metadata.store_path, session_id)
                        .map_err(|error| SessionSubmitError::Coordination {
                            message: SessionCoordinationError::store(format!(
                                "failed to recover stale steering: {error:#}"
                            )),
                        })?;
                expired.extend(
                    self.active_threads
                        .close_all(&self.metadata.store_path, session_id)
                        .map_err(|error| SessionSubmitError::Coordination {
                            message: SessionCoordinationError::store(format!(
                                "failed to clear stale worker targets: {error:#}"
                            )),
                        })?,
                );
                self.emit_steering_expired(expired);
            }
        }

        let run_id = SessionRunId::new();
        if !self.active_threads.begin_run(run_id.as_str()) {
            return Err(SessionSubmitError::Coordination {
                message: SessionCoordinationError::local_agent_busy(),
            });
        }

        let command_cancellation =
            if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
                // Orchestrator cancellation continues through its established
                // active-thread registry and must not add a new agent-lock
                // admission requirement.
                crate::tools::ThreadCancellation::default()
            } else {
                self.agent
                    .try_lock()
                    .map_err(|_| SessionSubmitError::Coordination {
                        message: SessionCoordinationError::local_agent_busy(),
                    })?
                    .begin_run_cancellation()
            };

        let submitted_at_epoch_ms = now_epoch_ms();
        let submitted_user_message = (!goal_continuation).then(|| SubmittedUserMessageSnapshot {
            run_id: run_id.clone(),
            client_id: client_id.clone(),
            content: expanded_prompt.to_string(),
            submitted_at_epoch_ms,
        });
        let active_run = ActiveRunSnapshot {
            run_id,
            client_id,
            // Preview what the user typed, not the expanded prompt: this
            // text feeds the events feed, history subtitles, and revision
            // labels, where `<invoked_skills>`/skill-body fragments would
            // leak.
            prompt_preview: if goal_continuation {
                "Durable goal continuation".to_string()
            } else {
                prompt_preview(&commands::display_prompt_from_message(expanded_prompt), 160)
            },
            submitted_user_message,
            started_at_epoch_ms: submitted_at_epoch_ms,
        };
        let (prompt_commit, _prompt_commit_receiver) =
            watch::channel(RunPromptCommitStatus::Pending);
        if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
            if let (Some(session_id), Some(execution_mode)) = (
                self.metadata.session_id.as_deref(),
                managed_orchestrator_execution_mode,
            ) {
                crate::store::begin_managed_orchestrator_run(
                    &self.metadata.store_path,
                    session_id,
                    active_run.run_id.as_str(),
                    execution_mode,
                )
                .map_err(|error| SessionSubmitError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to bind managed orchestrator generation to run: {error:#}"
                    )),
                })?;
            }
        } else {
            if let Some(session_id) = self.metadata.session_id.as_deref() {
                if crate::store::load_traditional_child(&self.metadata.store_path, session_id)
                    .map_err(|error| SessionSubmitError::Coordination {
                        message: SessionCoordinationError::store(format!(
                            "failed to inspect traditional child relationship: {error:#}"
                        )),
                    })?
                    .is_some()
                {
                    crate::store::begin_traditional_child_run(
                        &self.metadata.store_path,
                        session_id,
                        active_run.run_id.as_str(),
                        child_execution_mode
                            .unwrap_or(crate::store::TraditionalChildExecutionMode::Background),
                    )
                    .map_err(|error| SessionSubmitError::Coordination {
                        message: SessionCoordinationError::store(format!(
                            "failed to bind traditional child generation to run: {error:#}"
                        )),
                    })?;
                } else {
                    crate::store::bind_session_goal_run(
                        &self.metadata.store_path,
                        session_id,
                        &crate::store::GoalRunBaseline {
                            run_id: active_run.run_id.to_string(),
                            billable_tokens: 0,
                            started_at_epoch_ms: active_run.started_at_epoch_ms,
                            continuation: goal_continuation,
                        },
                    )
                    .map_err(|error| SessionSubmitError::Coordination {
                        message: SessionCoordinationError::store(format!(
                            "failed to bind goal accounting to run: {error:#}"
                        )),
                    })?;
                }
            }
        }
        *guard = Some(ActiveSessionOperation::Run(ActiveRunState {
            snapshot: active_run.clone(),
            started_at: Instant::now(),
            finishing: false,
            task: None,
            prompt_commit,
            transcript_baseline: None,
            command_cancellation,
            inbox_item_id,
            _operation_lease: operation_lease,
            _workspace_activity_lease: workspace_activity_lease,
        }));
        drop(guard);

        if let Some(session_id) = self.metadata.session_id.as_deref() {
            if let Err(error) = sessions::increment_run_count(&self.metadata.store_path, session_id)
            {
                eprintln!("nac: failed to record run count: {error:#}");
            }
        }

        self.event_bus.emit_with_context(
            SessionEvent::RunStarted {
                prompt_preview: active_run.prompt_preview.clone(),
                submitted_user_message: active_run.submitted_user_message.clone(),
                started_at_epoch_ms: active_run.started_at_epoch_ms,
            },
            Some(active_run.run_id.clone()),
            active_run.client_id.clone(),
        );

        Ok(active_run)
    }
}
