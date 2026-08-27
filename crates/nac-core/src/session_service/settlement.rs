use super::*;

impl SessionService {
    pub(super) async fn finish_run(&self, run_id: &SessionRunId, outcome: RunOutcome) {
        loop {
            if self.finish_run_once(run_id, outcome.clone()).await {
                return;
            }
            let retry_cleanup = {
                let guard = self.lock_active_operation();
                matches!(
                    guard.as_ref(),
                    Some(ActiveSessionOperation::Run(active_run))
                        if &active_run.snapshot.run_id == run_id && !active_run.finishing
                )
            };
            if !retry_cleanup {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub(super) async fn finish_run_once(&self, run_id: &SessionRunId, outcome: RunOutcome) -> bool {
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.terminal_manager.settle_run().await {
                self.event_bus.emit_agent(AgentEvent::Error {
                    thread_name: None,
                    message: format!(
                        "run {run_id} remains active because terminal cleanup is incomplete: {error:#}"
                    ),
                });
                return false;
            }
        }
        let Some(finishing_run) = self.mark_run_finishing(run_id) else {
            return false;
        };
        self.expire_orchestrator_steering(run_id);
        if matches!(outcome, RunOutcome::Failed(..)) {
            self.normalize_failed_run_transcript().await;
        }
        let (completed_duration_ms, completed_usage) = match &outcome {
            RunOutcome::Completed(_, usage) => (Some(finishing_run.duration_ms), usage.clone()),
            RunOutcome::Failed(_, usage) => (None, usage.clone()),
        };
        let durable_terminal = if matches!(outcome, RunOutcome::Failed(..)) {
            DurableRunTerminal::Failed
        } else {
            DurableRunTerminal::Completed
        };
        let goal_usage = completed_usage.clone();
        let goal_disposition = if matches!(outcome, RunOutcome::Failed(..)) {
            crate::store::GoalRunDisposition::Failed
        } else {
            crate::store::GoalRunDisposition::Completed
        };
        let persistence_error = match self
            .persist_run_snapshot(
                &finishing_run.snapshot,
                finishing_run.transcript_baseline,
                completed_duration_ms,
                completed_usage,
                durable_terminal,
            )
            .await
        {
            Ok(()) => None,
            Err(error) => {
                eprintln!(
                    "nac: failed to persist session snapshot for run {}: {error:#}",
                    finishing_run.snapshot.run_id
                );
                Some(format!("{error:#}"))
            }
        };

        self.capture_workspace_revision(&finishing_run.snapshot)
            .await;

        let (child_status, child_report, child_failure) = match &outcome {
            RunOutcome::Completed(response, _) => (
                crate::store::TraditionalChildStatus::Completed,
                Some(response.clone()),
                None,
            ),
            RunOutcome::Failed(message, _) => (
                crate::store::TraditionalChildStatus::Failed,
                None,
                Some(message.clone()),
            ),
        };
        self.settle_traditional_child_run(run_id, child_status, child_report, child_failure);

        self.settle_direct_goal_run(run_id, goal_usage, goal_disposition)
            .await;

        let run_id = finishing_run.snapshot.run_id.clone();
        let client_id = finishing_run.snapshot.client_id.clone();
        let terminal_event = match (outcome, persistence_error) {
            (RunOutcome::Completed(_, _), Some(error)) => SessionEvent::RunFailed {
                message: format!("run completed, but failed to persist session snapshot: {error}"),
            },
            (RunOutcome::Completed(response, _), None) => SessionEvent::RunCompleted {
                response,
                duration_ms: completed_duration_ms,
            },
            (RunOutcome::Failed(message, _), Some(error)) => SessionEvent::RunFailed {
                message: format!(
                    "{message}\nAdditionally, failed to persist session snapshot: {error}"
                ),
            },
            (RunOutcome::Failed(message, _), None) => SessionEvent::RunFailed { message },
        };
        self.event_bus
            .emit_with_context(terminal_event, Some(run_id.clone()), client_id);
        self.clear_finished_run(&run_id);
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.start_next_direct_inbox_item().await {
                eprintln!("nac: failed to promote direct inbox after run settlement: {error:#}");
            }
        }
        true
    }

    pub(super) async fn settle_direct_goal_run(
        &self,
        run_id: &SessionRunId,
        usage: Option<crate::model::TokenUsage>,
        disposition: crate::store::GoalRunDisposition,
    ) {
        if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
            return;
        }
        if let Some(session_id) = self.metadata.session_id.as_deref() {
            if let Err(error) = crate::store::settle_session_goal_run(
                &self.metadata.store_path,
                session_id,
                run_id.as_str(),
                usage
                    .as_ref()
                    .map_or(0, crate::model::TokenUsage::billable_tokens),
                now_epoch_ms(),
                disposition,
            ) {
                eprintln!("nac: failed to settle durable goal for run {run_id}: {error:#}");
            }
        }
        self.agent.lock().await.end_goal_run(run_id);
    }

    pub(super) fn settle_traditional_child_run(
        &self,
        run_id: &SessionRunId,
        status: crate::store::TraditionalChildStatus,
        report: Option<String>,
        failure: Option<String>,
    ) {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return;
        };
        let child =
            match crate::store::load_traditional_child(&self.metadata.store_path, session_id) {
                Ok(Some(child)) => child,
                Ok(None) => return,
                Err(error) => {
                    eprintln!("nac: failed to inspect traditional child settlement: {error:#}");
                    return;
                }
            };
        let revision = crate::store::workspace_revision_for_run(
            &self.metadata.store_path,
            session_id,
            run_id.as_str(),
        )
        .unwrap_or_else(|error| {
            eprintln!("nac: failed to read child workspace revision: {error:#}");
            None
        });
        let change_summary = revision.map(|revision| {
            format!(
                "{} files changed, +{} -{}",
                revision.changed_files, revision.additions, revision.deletions
            )
        });
        let verification_summary = report
            .as_deref()
            .and_then(|report| extract_report_section(report, "verification"));
        match crate::store::settle_traditional_child_run(
            &self.metadata.store_path,
            session_id,
            run_id.as_str(),
            crate::store::TraditionalChildTerminal {
                status,
                report,
                failure,
                change_summary,
                verification_summary,
            },
        ) {
            Ok(settlement)
                if settlement.newly_settled && settlement.child.completion_inbox_id.is_some() =>
            {
                if let Ok(controller) =
                    crate::traditional_children::controller_for(&self.metadata.store_path)
                {
                    let parent_session_id = child.parent_session_id;
                    tokio::spawn(async move {
                        if let Err(error) = controller.wake(&parent_session_id).await {
                            eprintln!(
                                "nac: failed to wake parent after child settlement: {error:#}"
                            );
                        }
                    });
                }
                if let Err(error) = crate::store::clear_settled_run_recovery(
                    &self.metadata.store_path,
                    session_id,
                    run_id.as_str(),
                ) {
                    eprintln!(
                        "nac: failed to clear settled child recovery for run {run_id}: {error:#}"
                    );
                }
            }
            Ok(_) => {
                if let Err(error) = crate::store::clear_settled_run_recovery(
                    &self.metadata.store_path,
                    session_id,
                    run_id.as_str(),
                ) {
                    eprintln!(
                        "nac: failed to clear settled child recovery for run {run_id}: {error:#}"
                    );
                }
            }
            Err(error) => {
                eprintln!("nac: failed to settle traditional child run {run_id}: {error:#}");
            }
        }
    }

    /// Freeze the checkout as it stands now, so the run can be revisited later.
    ///
    /// A revision is a convenience, never a precondition for anything, so every
    /// failure here is reported and swallowed: a repository nac cannot capture
    /// still gets its run finished normally.
    pub(super) async fn capture_workspace_revision(&self, run: &ActiveRunSnapshot) {
        let (Some(session_id), Some(target)) =
            (self.metadata.session_id.clone(), self.workspace_git.clone())
        else {
            return;
        };
        let store_path = self.metadata.store_path.clone();
        let run_id = run.run_id.to_string();
        let label = run.prompt_preview.clone();
        // Recorded now rather than derived later: this is the only moment we
        // can say for certain which transcript prefix the captured files go
        // with, and a revert has nothing else to key off.
        let transcript_len = self.transcript_len().await.ok();

        let outcome = tokio::task::spawn_blocking(move || -> Result<()> {
            let previous = crate::store::latest_workspace_revision(&store_path, &session_id)?
                .map(|revision| revision.commit_sha);
            let captured = crate::workspace::capture(&target, &session_id, previous.as_deref())?;
            crate::store::append_workspace_revision(
                &store_path,
                &session_id,
                crate::store::NewWorkspaceRevision {
                    run_id,
                    commit_sha: captured.commit,
                    base_sha: captured.base,
                    branch: captured.branch,
                    label,
                    additions: captured.additions,
                    deletions: captured.deletions,
                    changed_files: captured.changed_files,
                    transcript_len,
                },
            )?;
            Ok(())
        })
        .await;

        match outcome {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                eprintln!("nac: failed to capture workspace revision: {error:#}");
            }
            Err(error) => {
                eprintln!("nac: workspace revision task failed: {error}");
            }
        }
    }

    /// Run-failure transcript normalization: a run that fails at the
    /// tool-result commit point leaves a dangling assistant tool-call turn
    /// in the long-lived agent's transcript AND the transcript log (the
    /// assistant message committed to both; its tool results are in
    /// neither). The next run reuses this agent — restore-time
    /// normalization only runs at session admission — and providers reject
    /// a transcript whose assistant tool calls have no tool results, so
    /// every subsequent run would fail at the model call until re-attach.
    /// Trim the dangling turn from the vec and the log before the run-end
    /// bookkeeping reads the store. Done here rather than at the failing
    /// commit point so every commit-point failure is covered uniformly,
    /// mirroring the cancel path's terminal normalization
    /// (`append_cancellation_message`). Best-effort: a log failure here
    /// must not mask the run failure; the next restore re-normalizes the
    /// stale tail. Prompt/assistant append failures need no normalization
    /// (log-first: those messages are in neither store).
    pub(super) async fn normalize_failed_run_transcript(&self) {
        let mut agent = self.agent.lock().await;
        let result = if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
            agent.normalize_dangling_tail().await
        } else {
            agent.normalize_failed_tail_preserving_partial().await
        };
        if let Err(error) = result {
            eprintln!("nac: failed to normalize transcript after run failure: {error:#}");
        }
    }

    pub(super) fn expire_orchestrator_steering(&self, run_id: &SessionRunId) {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return;
        };
        match crate::store::expire_thread_steering(
            &self.metadata.store_path,
            session_id,
            run_id.as_str(),
        ) {
            Ok(records) => self.emit_steering_expired(records),
            Err(error) => {
                eprintln!("nac: failed to expire orchestrator steering: {error:#}");
            }
        }
    }

    pub(super) fn emit_steering_expired(&self, records: Vec<crate::store::ThreadSteeringRecord>) {
        for record in records {
            let instruction_preview = record.instruction.chars().take(160).collect();
            if record.thread_name == crate::store::ORCHESTRATOR_STEERING_TARGET {
                self.event_bus
                    .emit_agent(AgentEvent::OrchestratorSteeringExpired {
                        steering_id: record.id,
                        instruction_preview,
                    });
            } else {
                self.event_bus
                    .emit_agent(AgentEvent::ThreadSteeringExpired {
                        name: record.thread_name,
                        steering_id: record.id,
                        instruction_preview,
                    });
            }
        }
    }

    pub(super) fn mark_run_finishing(&self, run_id: &SessionRunId) -> Option<FinishingRun> {
        let mut guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() else {
            return None;
        };
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            return None;
        }
        active_run.finishing = true;
        active_run.snapshot.submitted_user_message = None;
        Some(FinishingRun {
            snapshot: active_run.snapshot.clone(),
            duration_ms: duration_ms(active_run.started_at.elapsed()),
            transcript_baseline: active_run.transcript_baseline,
        })
    }

    pub(super) fn mark_run_cancelling(&self, run_id: &SessionRunId) -> Option<CancellingRun> {
        let mut guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() else {
            return None;
        };
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            return None;
        }
        active_run.finishing = true;
        active_run.snapshot.submitted_user_message = None;
        Some(CancellingRun {
            service: self.clone(),
            snapshot: active_run.snapshot.clone(),
            task: active_run.task.take(),
            transcript_baseline: active_run.transcript_baseline,
            command_cancellation: active_run.command_cancellation.clone(),
        })
    }

    pub(super) fn run_prompt_commit(
        &self,
        run_id: &SessionRunId,
    ) -> Option<watch::Sender<RunPromptCommitStatus>> {
        let guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_ref() else {
            return None;
        };
        (&active_run.snapshot.run_id == run_id).then(|| active_run.prompt_commit.clone())
    }

    pub(super) fn run_inbox_item_id(&self, run_id: &SessionRunId) -> Option<i64> {
        let guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_ref() else {
            return None;
        };
        (&active_run.snapshot.run_id == run_id)
            .then_some(active_run.inbox_item_id)
            .flatten()
    }

    pub(super) fn set_run_task(&self, run_id: &SessionRunId, task: JoinHandle<()>) {
        let mut guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() else {
            task.abort();
            return;
        };
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            task.abort();
            return;
        }
        active_run.task = Some(task);
    }

    /// Store the run-start visible-response count captured by the run task
    /// (step 4). Dropped when the run is already finishing/cancelling — the
    /// persist path then falls back to the run-end count (exact when the
    /// task was cancelled before its first append).
    pub(super) fn set_run_transcript_baseline(&self, run_id: &SessionRunId, baseline: usize) {
        let mut guard = self.lock_active_operation();
        if let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() {
            if &active_run.snapshot.run_id == run_id && !active_run.finishing {
                active_run.transcript_baseline = Some(baseline);
            }
        }
    }

    pub(super) fn clear_finished_run(&self, run_id: &SessionRunId) {
        let mut guard = self.lock_active_operation();
        if guard.as_ref().is_some_and(|operation| {
            matches!(
                operation,
                ActiveSessionOperation::Run(active_run)
                    if &active_run.snapshot.run_id == run_id && active_run.finishing
            )
        }) {
            *guard = None;
        }
    }

    pub(super) fn lock_active_operation(
        &self,
    ) -> std::sync::MutexGuard<'_, Option<ActiveSessionOperation>> {
        self.active_operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Run-end persist (DB-direct transcript workset, step 4 — never-fold):
    /// performs NO `messages_json` rewrite. The snapshot blob is write-once
    /// (system head ++ legacy prefix); the transcript lives in the
    /// transcript log, appends-only. Token/timing bookkeeping diffs
    /// store-backed visible-response counts: `transcript_baseline` at run
    /// start (captured by the run task before its first append) vs the count
    /// at run end, advanced here over the run's appended log rows. Only
    /// run-state columns are persisted (`save_session_run_state`) and the
    /// in-memory snapshot is updated in place — no O(n) transcript clone
    /// anywhere. The in-memory update deliberately happens before the save:
    /// the duration/usage vectors are count-indexed histories, not diffs, so
    /// a failed save leaves both copies re-derivable from the counts at the
    /// next run end.
    pub(super) async fn persist_run_snapshot(
        &self,
        active_run: &ActiveRunSnapshot,
        transcript_baseline: Option<usize>,
        completed_duration_ms: Option<u64>,
        completed_usage: Option<crate::model::TokenUsage>,
        durable_terminal: DurableRunTerminal,
    ) -> Result<()> {
        let goal_final_billable_tokens = completed_usage
            .as_ref()
            .map_or(0, crate::model::TokenUsage::billable_tokens);
        {
            let snapshot = self.session_snapshot.lock().await;
            if snapshot.is_none() {
                return Ok(());
            }
        }
        self.update_transcript_scan().await?;
        let current_response_count = self.lock_transcript_scan().visible_response_count;
        let mut update = {
            let mut snapshot = self.session_snapshot.lock().await;
            let Some(snapshot) = snapshot.as_mut() else {
                return Ok(());
            };
            // Fallback when the run task never captured a baseline
            // (cancelled before its first append, or a capture failure):
            // diffing against the run-end count is exact in the no-append
            // case and only affects legacy history padding otherwise.
            let previous_response_count = transcript_baseline.unwrap_or(current_response_count);
            let response_timing = response_timing_after_run(
                snapshot,
                previous_response_count,
                current_response_count,
                completed_duration_ms,
            );
            let token_usages = token_usages_after_run(
                &snapshot.token_usages,
                previous_response_count,
                current_response_count,
                completed_usage.clone(),
            );
            let unattributed_token_usage = unattributed_usage_after_run(
                snapshot.unattributed_token_usage.clone(),
                current_response_count > previous_response_count,
                completed_usage,
            );
            snapshot.apply_run_state(sessions::SessionRunState {
                last_response_duration_ms: response_timing.last_response_duration_ms,
                previous_response_duration_ms: response_timing.previous_response_duration_ms,
                response_durations_ms: response_timing.response_durations_ms,
                token_usages,
                unattributed_token_usage,
            })
        };
        match durable_terminal {
            DurableRunTerminal::Completed | DurableRunTerminal::Cancelled => {
                update.finished_run_id = Some(active_run.run_id.to_string());
                update.finished_run_disposition = Some(match durable_terminal {
                    DurableRunTerminal::Completed => {
                        crate::store::RunTerminalDisposition::Completed
                    }
                    DurableRunTerminal::Cancelled => {
                        crate::store::RunTerminalDisposition::Cancelled
                    }
                    DurableRunTerminal::Failed => unreachable!(),
                });
            }
            DurableRunTerminal::Failed => {
                update.failed_run_id = Some(active_run.run_id.to_string());
            }
        }
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            update.goal_settlement = Some(crate::store::GoalRunSettlement {
                run_id: active_run.run_id.to_string(),
                final_billable_tokens: goal_final_billable_tokens,
                terminal_at_epoch_ms: now_epoch_ms(),
                disposition: match durable_terminal {
                    DurableRunTerminal::Completed => crate::store::GoalRunDisposition::Completed,
                    DurableRunTerminal::Cancelled => crate::store::GoalRunDisposition::Cancelled,
                    DurableRunTerminal::Failed => crate::store::GoalRunDisposition::Failed,
                },
            });
        }
        let saved_session_id = update.session_id.clone();
        let store_path = self.metadata.store_path.clone();
        tokio::task::spawn_blocking(move || sessions::save_session_run_state(&store_path, &update))
            .await??;

        self.event_bus.emit_with_context(
            SessionEvent::SnapshotSaved {
                session_id: saved_session_id,
            },
            Some(active_run.run_id.clone()),
            active_run.client_id.clone(),
        );

        Ok(())
    }
}
