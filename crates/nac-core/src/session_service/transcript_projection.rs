use super::*;

impl SessionService {
    pub(super) fn lock_transcript_scan(&self) -> std::sync::MutexGuard<'_, TranscriptScanCache> {
        self.transcript_scan
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Read a window of the transcript log tail relative to a snapshot blob
    /// of `blob_len` messages via the shared writer (atomic extent + window
    /// read, so a concurrent commit-point append cannot shift the window).
    /// `(0, [])` for services without a transcript log (pickers).
    async fn read_log_tail_window(
        &self,
        blob_len: usize,
        tail_start: usize,
        limit: usize,
    ) -> Result<(usize, Vec<(u64, Message)>)> {
        let (Some(writer), Some(session_id)) = (
            self.transcript_log.as_ref().map(Arc::clone),
            self.metadata.session_id.clone(),
        ) else {
            return Ok((0, Vec::new()));
        };
        tokio::task::spawn_blocking(move || {
            writer.read_tail_window(&session_id, blob_len as u64, tail_start as u64, limit)
        })
        .await
        .map_err(|error| anyhow::anyhow!("transcript log tail read task failed: {error}"))?
        .map(|(tail_len, rows)| (tail_len as usize, rows))
    }

    /// Row creation times for the window [`Self::read_log_tail_window`]
    /// returns. Empty for services without a transcript log (pickers).
    async fn read_log_tail_window_times(
        &self,
        blob_len: usize,
        tail_start: usize,
        limit: usize,
    ) -> Result<Vec<String>> {
        let (Some(writer), Some(session_id)) = (
            self.transcript_log.as_ref().map(Arc::clone),
            self.metadata.session_id.clone(),
        ) else {
            return Ok(Vec::new());
        };
        tokio::task::spawn_blocking(move || {
            writer.read_tail_window_times(&session_id, blob_len as u64, tail_start as u64, limit)
        })
        .await
        .map_err(|error| anyhow::anyhow!("transcript log tail time read task failed: {error}"))?
    }

    /// Read the full transcript log tail relative to a snapshot blob of
    /// `blob_len` messages via the shared writer. `[]` for services without
    /// a transcript log (pickers).
    async fn read_log_tail(&self, blob_len: usize) -> Result<Vec<(u64, Message)>> {
        let (Some(writer), Some(session_id)) = (
            self.transcript_log.as_ref().map(Arc::clone),
            self.metadata.session_id.clone(),
        ) else {
            return Ok(Vec::new());
        };
        tokio::task::spawn_blocking(move || writer.read_tail_from(&session_id, blob_len as u64))
            .await
            .map_err(|error| anyhow::anyhow!("transcript log tail read task failed: {error}"))?
    }

    /// The merged store transcript: the snapshot blob (authoritative legacy
    /// prefix) ++ the transcript log tail (rows with `idx >= blob_len`).
    /// This is exactly the agent's in-memory transcript, mid-run and
    /// post-run alike — never-fold (step 4): the blob is write-once and the
    /// tail only grows, run end no longer folds the log into the blob.
    pub(super) async fn store_backed_transcript(&self) -> Result<Vec<Message>> {
        let (blob_len, mut messages) = {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            (blob.len(), blob.to_vec())
        };
        let tail = self.read_log_tail(blob_len).await?;
        messages.extend(tail.into_iter().map(|(_, message)| message));
        Ok(messages)
    }

    /// Page the merged store transcript without decoding rows outside the
    /// requested visible window. Visible↔raw mapping: the blob contributes
    /// `blob_visible` visible messages (all but the system head), and every
    /// log row is visible (no commit point ever logs a System message), so
    /// visible index `v >= blob_visible` is the tail row with
    /// `idx = blob_len + (v - blob_visible)`.
    pub(super) async fn page_store_transcript(
        &self,
        request: MessagePageRequest,
    ) -> Result<MessagesPageSnapshot> {
        let include_system = request.include_system;
        let is_visible =
            |message: &&Message| include_system || !matches!(message, Message::System { .. });
        let (blob_len, blob_visible) = {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            (blob.len(), blob.iter().filter(is_visible).count())
        };
        let (tail_len, _) = self.read_log_tail_window(blob_len, 0, 0).await?;
        let total = blob_visible + tail_len;
        let end = request.before.unwrap_or(total).min(total);
        let limit = request.limit.max(1);
        let start = end.saturating_sub(limit);

        let blob_end = end.min(blob_visible);
        let blob_part: Vec<Message> = if start < blob_end {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            blob.iter()
                .filter(is_visible)
                .skip(start)
                .take(blob_end - start)
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        let (log_part, log_times): (Vec<Message>, Vec<String>) = if end > blob_visible {
            let tail_start = start.saturating_sub(blob_visible);
            let count = end - blob_visible - tail_start;
            let (_, rows) = self
                .read_log_tail_window(blob_len, tail_start, count)
                .await?;
            let times = self
                .read_log_tail_window_times(blob_len, tail_start, count)
                .await?;
            (
                rows.into_iter().map(|(_, message)| message).collect(),
                times,
            )
        } else {
            (Vec::new(), Vec::new())
        };
        let mut created_at: Vec<Option<String>> = vec![None; blob_part.len()];
        created_at.extend(log_times.into_iter().map(Some));
        let mut messages = blob_part;
        messages.extend(log_part);
        created_at.resize(messages.len(), None);
        Ok(MessagesPageSnapshot {
            messages,
            created_at,
            page: MessagePageMetadata {
                start,
                end,
                total,
                has_older: start > 0,
            },
        })
    }

    /// Length of the merged store transcript without decoding any of it.
    pub(super) async fn transcript_len(&self) -> Result<u64> {
        let blob_len = {
            let snapshot = self.session_snapshot.lock().await;
            snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.len())
                .unwrap_or_default()
        };
        let (tail_len, _) = self.read_log_tail_window(blob_len, 0, 0).await?;
        Ok((blob_len + tail_len) as u64)
    }

    /// What the user typed to produce the message at `message_idx`, rather
    /// than the expanded prompt the agent was handed: sending it again has to
    /// go back through the same expansion, or a `/plan` would reach the model
    /// as its own instruction sheet.
    pub async fn user_input_at(&self, message_idx: usize) -> Result<String> {
        let messages = self.store_backed_transcript().await?;
        match messages.get(message_idx) {
            Some(Message::User { content }) => Ok(commands::display_prompt_from_message(content)),
            Some(_) => Err(anyhow::anyhow!(
                "message {message_idx} is not a user message, and only a user message can be sent again"
            )),
            None => Err(anyhow::anyhow!(
                "message {message_idx} is not in this session's transcript"
            )),
        }
    }

    /// Take the session back to just before the user message at `message_idx`:
    /// that message and everything after it leave the transcript, and the
    /// checkout returns to the revision that was current when it was sent.
    ///
    /// Order matters. The checkout is restored first, because a git failure
    /// there is recoverable — nothing has been forgotten yet — whereas a
    /// transcript truncated against a checkout that then refuses to move would
    /// leave the two describing different moments with no way back. Everything
    /// after the truncation is bookkeeping that follows from it.
    ///
    /// This is destructive by design and has no undo: the callers above it are
    /// responsible for holding the session's operation lease, so that no run is
    /// writing to the transcript or the checkout while it happens.
    pub async fn revert_to_message(&self, message_idx: usize) -> Result<RevertOutcome> {
        let session_id =
            self.metadata.session_id.clone().ok_or_else(|| {
                anyhow::anyhow!("this session is not persisted, so it cannot revert")
            })?;
        let writer = self
            .transcript_log
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| anyhow::anyhow!("this session has no transcript log to revert"))?;

        let messages = self.store_backed_transcript().await?;
        let target = messages.get(message_idx).ok_or_else(|| {
            anyhow::anyhow!("message {message_idx} is not in this session's transcript")
        })?;
        if !matches!(target, Message::User { .. }) {
            return Err(anyhow::anyhow!(
                "message {message_idx} is not a user message, and only a user message marks a point to revert to"
            ));
        }
        let blob_len = {
            let snapshot = self.session_snapshot.lock().await;
            snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.len())
                .unwrap_or_default()
        };
        if message_idx < blob_len {
            return Err(anyhow::anyhow!(
                "message {message_idx} predates this session's transcript log and cannot be reverted to"
            ));
        }

        let store_path = self.metadata.store_path.clone();
        let workspace_git = self.workspace_git.clone();
        let revision = {
            let store_path = store_path.clone();
            let session_id = session_id.clone();
            tokio::task::spawn_blocking(move || {
                crate::store::workspace_revision_at_transcript_len(
                    &store_path,
                    &session_id,
                    message_idx as u64,
                )
            })
            .await
            .map_err(|error| anyhow::anyhow!("workspace revision lookup task failed: {error}"))??
        };

        let workspace_restored = match (&workspace_git, &revision) {
            (Some(target), Some(revision)) => {
                let target = target.clone();
                let session_id = session_id.clone();
                let commit = revision.commit_sha.clone();
                tokio::task::spawn_blocking(move || {
                    crate::workspace::restore(&target, &session_id, &commit)?;
                    crate::workspace::rewind_ref(&target, &session_id, &commit)
                })
                .await
                .map_err(|error| anyhow::anyhow!("workspace restore task failed: {error}"))??;
                true
            }
            _ => false,
        };

        {
            let writer = Arc::clone(&writer);
            let session_id = session_id.clone();
            tokio::task::spawn_blocking(move || {
                writer.delete_from(&session_id, message_idx as u64)
            })
            .await
            .map_err(|error| anyhow::anyhow!("transcript truncation task failed: {error}"))??;
        }

        let kept = &messages[..message_idx];
        {
            let mut agent = self.agent.lock().await;
            agent.messages.truncate(message_idx);
        }
        {
            let mut scan = self
                .transcript_scan
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *scan = TranscriptScanCache::from_transcript(kept);
        }

        // The timing history is indexed by visible response, so it has to lose
        // exactly the responses the transcript just lost, or every later run
        // would attribute its duration to the wrong message.
        let kept_responses = kept
            .iter()
            .filter(|message| is_visible_response(message))
            .count();
        let run_state_update = {
            let mut snapshot = self.session_snapshot.lock().await;
            snapshot.as_mut().map(|snapshot| {
                let mut durations =
                    response_duration_history_from_snapshot(snapshot, kept_responses);
                durations.truncate(kept_responses);
                let mut token_usages = snapshot.token_usages.clone();
                token_usages.truncate(kept_responses);
                // Not response-indexed, so a truncation has nothing to drop
                // from it: the failed runs it accounts for stay accounted for.
                let unattributed_token_usage = snapshot.unattributed_token_usage.clone();
                let last = durations.last().copied().flatten();
                let previous = durations
                    .len()
                    .checked_sub(2)
                    .and_then(|idx| durations.get(idx).copied().flatten());
                snapshot.apply_run_state(sessions::SessionRunState {
                    last_response_duration_ms: last,
                    previous_response_duration_ms: previous,
                    response_durations_ms: Some(durations),
                    token_usages,
                    unattributed_token_usage,
                })
            })
        };
        if let Some(update) = run_state_update {
            let store_path = store_path.clone();
            tokio::task::spawn_blocking(move || {
                sessions::save_session_run_state(&store_path, &update)
            })
            .await
            .map_err(|error| anyhow::anyhow!("session run state task failed: {error}"))??;
        }

        let revisions_removed = {
            let store_path = store_path.clone();
            let session_id = session_id.clone();
            let keep_through_id = revision.as_ref().map(|revision| revision.id);
            tokio::task::spawn_blocking(move || {
                crate::store::delete_workspace_revisions_after(
                    &store_path,
                    &session_id,
                    keep_through_id,
                )
            })
            .await
            .map_err(|error| anyhow::anyhow!("workspace revision prune task failed: {error}"))??
        };

        // Threads the discarded messages dispatched are work nothing can reach
        // any more: the tool calls that named them are gone. A name the kept
        // messages also dispatched stays whole, because the same rows carry the
        // episodes of those earlier dispatches, which the transcript still
        // refers to.
        let orphaned_threads: Vec<String> = {
            let kept_names = thread_tool_call_names(kept);
            thread_tool_call_names(&messages[message_idx..])
                .into_iter()
                .filter(|name| {
                    name != crate::store::ORCHESTRATOR_STEERING_TARGET && !kept_names.contains(name)
                })
                .collect()
        };
        let threads_removed = {
            let store_path = store_path.clone();
            let session_id = session_id.clone();
            tokio::task::spawn_blocking(move || {
                let mut removed = 0usize;
                for name in orphaned_threads {
                    if crate::store::delete_thread(&store_path, &session_id, &name)? {
                        removed += 1;
                    }
                }
                anyhow::Ok(removed)
            })
            .await
            .map_err(|error| anyhow::anyhow!("thread prune task failed: {error}"))??
        };

        self.event_bus.emit(SessionEvent::TranscriptReverted {
            transcript_len: message_idx as u64,
        });

        Ok(RevertOutcome {
            transcript_len: message_idx,
            messages_removed: messages.len() - message_idx,
            workspace_restored,
            revisions_removed,
            threads_removed,
        })
    }

    /// Per-message creation times aligned with [`Self::store_backed_transcript`],
    /// which is why the caller passes the transcript length it already read:
    /// an append landing between the two reads must not shift the alignment.
    /// Blob messages predate the log and report `None`.
    pub(super) async fn store_backed_transcript_times(
        &self,
        total: usize,
    ) -> Result<Vec<Option<String>>> {
        let blob_len = {
            let snapshot = self.session_snapshot.lock().await;
            snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.len())
                .unwrap_or_default()
        }
        .min(total);
        let mut times: Vec<Option<String>> = vec![None; blob_len];
        if total > blob_len {
            let tail = self
                .read_log_tail_window_times(blob_len, 0, total - blob_len)
                .await?;
            times.extend(tail.into_iter().map(Some));
        }
        times.resize(total, None);
        Ok(times)
    }

    /// Advance the incremental transcript scan over newly appended rows.
    /// The delta is read from the store: the log window past the scanned
    /// cursor, plus the blob part when the blob grew past it — dead in
    /// production since step 4 (never-fold: the blob is write-once), kept
    /// for tests that reseed the blob. Positions already consumed by a
    /// concurrent update are skipped. A shrinking merged length means
    /// crash/cancel normalization trimmed a dangling (non-User) tail: the
    /// scan cursor rewinds, counts are unaffected.
    pub(super) async fn update_transcript_scan(&self) -> Result<()> {
        if self.transcript_log.is_none() {
            return Ok(());
        }
        let scanned_len = self.lock_transcript_scan().scanned_len;
        let (blob_len, blob_delta) = {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            let blob_len = blob.len();
            let delta = if scanned_len < blob_len {
                blob[scanned_len..blob_len].to_vec()
            } else {
                Vec::new()
            };
            (blob_len, delta)
        };
        let tail_start = scanned_len.saturating_sub(blob_len);
        let (tail_len, rows) = self
            .read_log_tail_window(blob_len, tail_start, usize::MAX)
            .await?;
        let merged_len = blob_len + tail_len;
        let mut cache = self.lock_transcript_scan();
        if merged_len < cache.scanned_len {
            cache.scanned_len = merged_len;
            return Ok(());
        }
        for (position, message) in (scanned_len..).zip(
            blob_delta
                .iter()
                .chain(rows.iter().map(|(_, message)| message)),
        ) {
            if position >= cache.scanned_len {
                cache.scan_message(position, message);
                cache.scanned_len = position + 1;
            }
        }
        Ok(())
    }

    /// Message-cycle metadata from the store transcript: counts come from
    /// the incremental scan cache; thread names come from a bounded tail
    /// scan of the messages after the latest user message (one cycle).
    pub(super) async fn message_cycle_from_store(&self) -> Result<MessageCycleMetadata> {
        let (user_count, last_user_idx) = {
            let cache = self.lock_transcript_scan();
            (cache.user_count, cache.last_user_idx)
        };
        let Some(last_user_idx) = last_user_idx else {
            return Ok(MessageCycleMetadata {
                marker: "none".to_string(),
                thread_names: Vec::new(),
            });
        };
        let (blob_len, mut after) = {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            let blob_len = blob.len();
            let start = (last_user_idx + 1).min(blob_len);
            (blob_len, blob[start..blob_len].to_vec())
        };
        let (_, rows) = self
            .read_log_tail_window(
                blob_len,
                (last_user_idx + 1).saturating_sub(blob_len),
                usize::MAX,
            )
            .await?;
        after.extend(rows.into_iter().map(|(_, message)| message));
        Ok(MessageCycleMetadata {
            marker: format!("history:{user_count}:{last_user_idx}"),
            thread_names: thread_tool_call_names(&after),
        })
    }

    /// Returns the freshest orchestrator messages available without building
    /// the considerably larger frontend snapshot: the merged store
    /// transcript (snapshot blob ++ transcript log tail), live mid-run.
    pub async fn messages_snapshot(&self) -> Result<Vec<Message>> {
        self.store_backed_transcript().await
    }
}
