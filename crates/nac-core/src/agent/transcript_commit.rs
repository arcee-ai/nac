use super::*;

impl Agent {
    pub(crate) fn bind_transcript_run(
        &mut self,
        run_id: &str,
        lease: &Arc<crate::sessions::SessionOperationLease>,
    ) -> Result<()> {
        if let Some(sink) = self.transcript_log.as_mut() {
            sink.writer = Arc::new(crate::store::TranscriptLogWriter::for_run(
                &sink.store_path,
                &sink.session_id,
                run_id,
                lease,
            )?);
        }
        Ok(())
    }

    /// Append `messages` to the transcript log at absolute positions
    /// `start_idx..` via `spawn_blocking` (steering-claim precedent). A no-op
    /// for agents without a transcript log (workers, picker sessions).
    pub(super) async fn log_transcript_batch(
        &mut self,
        start_idx: u64,
        messages: &[Message],
    ) -> Result<()> {
        self.log_transcript_batch_inner(start_idx, messages, false)
            .await
    }

    async fn log_transcript_batch_inner(
        &mut self,
        start_idx: u64,
        messages: &[Message],
        terminal: bool,
    ) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        if messages.is_empty() {
            return Ok(());
        }
        let writer = Arc::clone(&sink.writer);
        let session_id = sink.session_id.clone();
        let messages = messages.to_vec();
        let batch_len = messages.len() as u64;
        // Track pending rows at submission, before the await: a run task
        // dropped while the blocking append is in flight cannot interrupt
        // it, so the append still completes without this function ever
        // resuming. The up-front claim keeps that straggler row within this
        // process's pending writes, so terminal normalization resolves it instead
        // of mistaking it for a peer's committed row (issue #146).
        self.pending_log_end = Some(start_idx + batch_len);
        let appended = crate::store::spawn_blocking_store_caller(move || {
            if terminal {
                writer.append_terminal_batch(&session_id, start_idx, &messages)
            } else {
                writer.append_batch(&session_id, start_idx, &messages)
            }
        })
        .await
        .map_err(|error| anyhow!("transcript log append task failed: {error}"))?;
        match appended {
            Ok(()) => {
                // Live trigger (step 3): emitted after the log commit,
                // before the vec push — the store-backed read path sees the
                // rows immediately.
                self.committed_log_len = start_idx + batch_len;
                self.pending_log_end = None;
                self.event_sink
                    .emit_transcript_appended_async(start_idx + batch_len)
                    .await;
                Ok(())
            }
            Err(error) => {
                // An unacknowledged durable row is discovered by the store
                // reload guard. Do not advance the confirmed commit length.
                self.pending_log_end = None;
                Err(error)
            }
        }
    }

    /// Append one message to the transcript log at absolute position `idx`
    /// via `spawn_blocking`. A no-op for agents without a transcript log.
    pub(super) async fn log_transcript_message(
        &mut self,
        idx: u64,
        message: &Message,
    ) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        let writer = Arc::clone(&sink.writer);
        let session_id = sink.session_id.clone();
        let message = message.clone();
        let submitted_message = message.clone();
        // Track the pending row at submission, before the await — see
        // log_transcript_batch for why the straggler from a dropped run
        // task must stay within this process's own commits.
        self.pending_log_end = Some(idx + 1);
        let appended = crate::store::spawn_blocking_store_caller(move || {
            writer.append(&session_id, idx, &message)
        })
        .await
        .map_err(|error| anyhow!("transcript log append task failed: {error}"))?;
        match appended {
            Ok(()) => {
                // Live trigger (step 3): see log_transcript_batch.
                self.committed_log_len = idx + 1;
                self.pending_log_end = None;
                self.unacknowledged_log_message = None;
                self.event_sink
                    .emit_transcript_appended_async(idx + 1)
                    .await;
                Ok(())
            }
            Err(error) => {
                if error.downcast_ref::<crate::store::TranscriptAppendError>()
                    == Some(&crate::store::TranscriptAppendError::CommitUncertain)
                {
                    self.unacknowledged_log_message = Some((idx, submitted_message));
                }
                self.pending_log_end = None;
                Err(error)
            }
        }
    }

    /// Replay the exact operation before terminal cleanup can synthesize a
    /// partial response. Failure leaves it pending for the next recovery attempt.
    pub(super) async fn reconcile_unacknowledged_message(&mut self) -> Result<()> {
        let Some((idx, message)) = self.unacknowledged_log_message.clone() else {
            return Ok(());
        };
        self.log_transcript_message(idx, &message).await?;
        self.unacknowledged_log_message = Some((idx, message.clone()));
        self.reload_transcript_from_store().await?;
        if matches!(message, Message::Assistant { .. }) {
            self.clear_partial_stream();
        }
        self.unacknowledged_log_message = None;
        Ok(())
    }

    /// Push one message into the transcript, appending it to the log first
    /// (log-first: the vec never holds an undurable message). `idx` is the
    /// absolute Vec index — `messages.len()` before the push.
    pub(super) async fn push_and_log(&mut self, message: Message) -> Result<()> {
        let idx = self.messages.len() as u64;
        self.log_transcript_message(idx, &message).await?;
        self.messages.push(message);
        Ok(())
    }
    pub(super) async fn push_and_log_run_prompt(
        &mut self,
        message: Message,
        run_id: &SessionRunId,
        inbox_item_id: Option<i64>,
    ) -> Result<()> {
        self.tool_runtime.check_execution_authority().await?;
        let idx = self.messages.len() as u64;
        if let Some(sink) = &self.transcript_log {
            let writer = Arc::clone(&sink.writer);
            let session_id = sink.session_id.clone();
            let stored_message = message.clone();
            let run_id = run_id.to_string();
            let admission: Option<Arc<crate::store::RunPromptAdmission>> = self
                .tool_runtime
                .host_execution_authority
                .as_ref()
                .map(|_| ())
                .or_else(|| {
                    (self.tool_runtime.runtime_effect_required
                        || self.tool_runtime.runtime_effect_lease.is_some())
                    .then_some(())
                })
                .map(|()| {
                    let cancellation = self.tool_runtime.command_cancellation.clone();
                    Arc::new(move |operation: &dyn Fn() -> Result<()>| {
                        cancellation.run_if_active(operation).unwrap_or_else(|| {
                            Err(anyhow!("run prompt denied before durable commit"))
                        })
                    }) as Arc<crate::store::RunPromptAdmission>
                });
            self.steering_append_pending = true;
            self.pending_log_end = Some(idx + 1);
            let appended = crate::store::spawn_blocking_store_caller(move || {
                let append = || {
                    if let Some(admission) = &admission {
                        writer.append_admitted_run_prompt(
                            &session_id,
                            idx,
                            &stored_message,
                            &run_id,
                            inbox_item_id,
                            admission,
                        )
                    } else {
                        match inbox_item_id {
                            Some(inbox_item_id) => writer.append_inbox_run_prompt(
                                &session_id,
                                idx,
                                &stored_message,
                                &run_id,
                                inbox_item_id,
                            ),
                            None => {
                                writer.append_run_prompt(&session_id, idx, &stored_message, &run_id)
                            }
                        }
                    }
                };
                match append() {
                    Err(error)
                        if error.downcast_ref::<crate::store::TranscriptAppendError>()
                            == Some(&crate::store::TranscriptAppendError::CommitUncertain) =>
                    {
                        // Keep the exact run/index/inbox identity. A second
                        // uncertain outcome must not become a new goal run.
                        append().map_err(|error| {
                            error.context(crate::store::TranscriptAppendError::CommitUncertain)
                        })
                    }
                    result => result,
                }
            })
            .await
            .map_err(|error| anyhow!("run prompt append task failed: {error}"))?;
            if let Err(error) = appended {
                let uncertain = error.downcast_ref::<crate::store::TranscriptAppendError>()
                    == Some(&crate::store::TranscriptAppendError::CommitUncertain);
                if uncertain {
                    // Reload will reconcile any canonical prompt. Scheduling
                    // another logical run before that would duplicate input.
                    let mut failure =
                        crate::store::TranscriptAppendError::CommitUncertain.run_failure();
                    failure.transient = false;
                    return Err(error.context(failure));
                }
                self.steering_append_pending = false;
                self.pending_log_end = None;
                return Err(error);
            }
            self.steering_append_pending = false;
            self.pending_log_end = None;
            self.committed_log_len = idx + 1;
            self.event_sink
                .emit_transcript_appended_async(idx + 1)
                .await;
        }
        self.messages.push(message);
        Ok(())
    }

    /// Push a batch into the transcript atomically: the whole batch is
    /// logged in one transaction before any of it enters the vec.
    pub(super) async fn push_batch_and_log(&mut self, messages: Vec<Message>) -> Result<()> {
        let start_idx = self.messages.len() as u64;
        self.log_transcript_batch(start_idx, &messages).await?;
        self.messages.extend(messages);
        Ok(())
    }

    pub(super) async fn push_terminal_batch_and_log(
        &mut self,
        messages: Vec<Message>,
    ) -> Result<()> {
        let start_idx = self.messages.len() as u64;
        self.log_transcript_batch_inner(start_idx, &messages, true)
            .await?;
        self.messages.extend(messages);
        Ok(())
    }

    /// Commit a proposed steering tail and its delivery statuses in one SQLite
    /// transaction. The in-memory vector is adopted only after this returns,
    /// preserving the log-first invariant even if the run is cancelled while
    /// the blocking transaction is pending.
    pub(super) async fn commit_staged_steering(
        &mut self,
        from_idx: usize,
        steering_ids: &[i64],
        staged: &[Message],
        session_id: &str,
        dispatch_id: &str,
    ) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return crate::store::acknowledge_thread_steering_batch(
                &self.tool_runtime.store_path,
                steering_ids,
                session_id,
                dispatch_id,
            );
        };
        if staged.is_empty() {
            return Ok(());
        }
        let writer = Arc::clone(&sink.writer);
        let sink_session_id = sink.session_id.clone();
        let dispatch_id = dispatch_id.to_string();
        let steering_ids = steering_ids.to_vec();
        let batch_len = staged.len() as u64;
        self.pending_log_end = Some(from_idx as u64 + batch_len);
        let staged = staged.to_vec();
        self.steering_append_pending = true;
        let joined = crate::store::spawn_blocking_store_caller(move || {
            writer.append_claimed_thread_steering(
                &sink_session_id,
                &dispatch_id,
                &steering_ids,
                from_idx as u64,
                &staged,
            )
        })
        .await;
        self.steering_append_pending = false;
        let committed =
            joined.map_err(|error| anyhow!("steering transcript commit task failed: {error}"))?;
        match committed {
            Ok(()) => {
                self.committed_log_len = from_idx as u64 + batch_len;
                self.pending_log_end = None;
                self.event_sink
                    .emit_transcript_appended_async(from_idx as u64 + batch_len)
                    .await;
                Ok(())
            }
            Err(error) => {
                self.pending_log_end = None;
                Err(error)
            }
        }
    }

    pub(super) async fn append_pending_direct_inbox(&mut self) -> Result<usize> {
        let Some(sink) = &self.transcript_log else {
            return Ok(0);
        };
        let run_id = self
            .steering_dispatch_id
            .clone()
            .ok_or_else(|| anyhow!("direct inbox delivery requires an active run id"))?;
        let writer = Arc::clone(&sink.writer);
        let session_id = sink.session_id.clone();
        let start_idx = self.messages.len() as u64;
        // Claim the possible append before spawn_blocking for the same reason
        // as ordinary transcript appends: cancellation must recognize a row
        // that commits after the async task is aborted as this process's row.
        self.pending_log_end = Some(start_idx + 1);
        self.direct_inbox_append_start = Some(start_idx);
        let records = crate::store::spawn_blocking_store_caller(move || {
            writer.append_pending_inbox_steers(&session_id, &run_id, start_idx)
        })
        .await
        .map_err(|error| anyhow!("direct inbox append task failed: {error}"))?;
        let records = match records {
            Ok(records) => records,
            Err(error) => {
                self.direct_inbox_append_start = None;
                self.pending_log_end = None;
                return Err(error);
            }
        };
        if records.is_empty() {
            self.direct_inbox_append_start = None;
            self.pending_log_end = None;
            return Ok(0);
        }
        self.messages
            .extend(records.iter().map(|record| Message::User {
                content: record.content.clone(),
            }));
        self.committed_log_len = self.messages.len() as u64;
        self.pending_log_end = None;
        self.direct_inbox_append_start = None;
        self.event_sink
            .emit_transcript_appended_async(self.messages.len() as u64)
            .await;
        Ok(records.len())
    }
}
