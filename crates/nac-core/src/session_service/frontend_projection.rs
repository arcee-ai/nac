use super::*;

impl SessionService {
    pub fn list_sessions(&self) -> Result<Vec<SessionSummarySnapshot>> {
        view::list_sessions(&self.metadata.store_path)
    }

    pub fn list_threads(&self) -> Result<Vec<ThreadSnapshot>> {
        view::list_threads(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn thread_episodes(&self, thread_name: &str) -> Result<Vec<EpisodeSnapshot>> {
        view::load_thread_episodes(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
            thread_name,
        )
    }

    pub fn all_thread_episodes(&self) -> Result<HashMap<String, Vec<EpisodeSnapshot>>> {
        view::load_all_thread_episodes(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    fn load_all_thread_events_with_connection(
        &self,
        conn: &rusqlite::Connection,
        per_thread_limit: usize,
    ) -> Result<DecodedThreadEvents> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(DecodedThreadEvents {
                events: HashMap::new(),
                diagnostics: Vec::new(),
            });
        };
        let records = crate::store::load_all_thread_events_with_connection(
            conn,
            session_id,
            per_thread_limit,
        )?;
        Ok(decode_thread_events(records))
    }

    fn load_frontend_snapshot_blocking(
        &self,
        options: FrontendSnapshotLoadOptions,
    ) -> Result<FrontendSnapshotBlockingLoad> {
        let workspace = self.workspace_snapshot();
        #[cfg(test)]
        if let Some(gate) = &self.frontend_snapshot_after_workspace_gate {
            gate.pause();
        }

        let (
            sessions,
            threads,
            thread_episodes,
            thread_events,
            thread_event_boundary,
            thread_steering,
            run_recovery_warning,
            worksets,
        ) = {
            let conn = crate::store::open_runtime_connection(&self.metadata.store_path)?;
            let session_id = self.metadata.session_id.as_deref();
            let sessions = if options.include_sessions {
                view::list_sessions_with_connection(&conn)?
            } else {
                Vec::new()
            };
            let threads = view::list_threads_with_connection(&conn, session_id)?;
            let thread_episodes =
                view::load_all_thread_episodes_with_connection(&conn, session_id)?;
            let (thread_event_boundary, thread_events) =
                self.event_bus.thread_event_boundary(|| {
                    self.load_all_thread_events_with_connection(&conn, options.thread_event_limit)
                })?;
            let worksets = view::worksets_snapshot_with_connection(&conn, session_id);
            // Keep this final storage read adjacent to the transcript scan so
            // a delivery committed during slower workspace inspection has the
            // current status needed to cover its canonical message.
            let thread_steering = session_id
                .map(|session_id| {
                    crate::store::list_thread_steering_with_connection(&conn, session_id)
                })
                .transpose()?
                .unwrap_or_default();
            let run_recovery_warning = session_id
                .map(|session_id| {
                    crate::store::load_run_recovery_with_connection(&conn, session_id)
                })
                .transpose()?
                .flatten()
                .and_then(|record| match record.status {
                    crate::store::RunRecoveryStatus::Active => None,
                    crate::store::RunRecoveryStatus::Interrupted => {
                        Some(INTERRUPTED_RUN_WARNING.to_string())
                    }
                    crate::store::RunRecoveryStatus::Failed => Some(FAILED_RUN_WARNING.to_string()),
                });
            (
                sessions,
                threads,
                thread_episodes,
                thread_events,
                thread_event_boundary,
                thread_steering,
                run_recovery_warning,
                worksets,
            )
        };
        Ok(FrontendSnapshotBlockingLoad {
            sessions,
            threads,
            thread_episodes,
            thread_events,
            thread_event_boundary,
            thread_steering,
            run_recovery_warning,
            worksets,
            workspace,
        })
    }
}

fn decode_thread_events(
    records: HashMap<String, Vec<crate::store::ThreadEventRecord>>,
) -> DecodedThreadEvents {
    let mut events = HashMap::new();
    let mut diagnostics = Vec::new();
    for (thread_name, records) in records {
        let decoded = records
            .into_iter()
            .filter_map(|record| decode_thread_event(record, &mut diagnostics))
            .collect::<Vec<_>>();
        if !decoded.is_empty() {
            events.insert(thread_name, decoded);
        }
    }
    DecodedThreadEvents {
        events,
        diagnostics,
    }
}

impl SessionService {
    pub fn thread_events_page(
        &self,
        thread_name: &str,
        before_id: Option<i64>,
        limit: usize,
    ) -> Result<ThreadEventPage> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let (thread_event_boundary, (records, has_older)) = if before_id.is_none() {
            // Persistence also checks out before taking the event state lock.
            // Keep the latest-page snapshot on the same order so capacity
            // saturation cannot deadlock emitters against this boundary.
            let connection = crate::store::open_runtime_connection(&self.metadata.store_path)?;
            let load = || {
                crate::store::load_thread_events_page_with_connection(
                    &connection,
                    session_id,
                    thread_name,
                    before_id,
                    limit,
                )
            };
            let (boundary, records) = self.event_bus.thread_event_boundary(load)?;
            (Some(boundary), records)
        } else {
            (
                None,
                crate::store::load_thread_events_page(
                    &self.metadata.store_path,
                    session_id,
                    thread_name,
                    before_id,
                    limit,
                )?,
            )
        };
        let next_before_id = records.last().map(|record| record.id);
        let mut diagnostics = Vec::new();
        let events = records
            .into_iter()
            .filter_map(|record| {
                let id = record.id;
                let created_at = record.created_at.clone();
                decode_thread_event(record, &mut diagnostics).map(|event| ThreadEventPageItem {
                    id,
                    created_at,
                    event,
                })
            })
            .collect();
        Ok(ThreadEventPage {
            next_before_id,
            events,
            has_older,
            thread_event_boundary,
            diagnostics,
        })
    }

    pub fn list_worksets(&self) -> Result<Vec<WorksetSummarySnapshot>> {
        view::list_worksets(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn read_workset(&self, workset_id: &str) -> Result<Option<WorksetSnapshot>> {
        view::read_workset(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
            workset_id,
        )
    }

    pub fn worksets_snapshot(&self) -> WorksetsSnapshot {
        view::worksets_snapshot(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn workspace_snapshot(&self) -> WorkspaceSnapshot {
        view::workspace_snapshot(&self.metadata.cwd, self.workspace_git.as_ref())
    }

    pub async fn frontend_snapshot(&self) -> Result<SessionFrontendSnapshot> {
        Ok(self
            .frontend_snapshot_with_options(FrontendSnapshotLoadOptions::default())
            .await?
            .snapshot)
    }

    pub async fn frontend_snapshot_with_thread_event_limit(
        &self,
        thread_event_limit: usize,
    ) -> Result<SessionFrontendSnapshot> {
        Ok(self
            .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
                thread_event_limit,
                ..FrontendSnapshotLoadOptions::default()
            })
            .await?
            .snapshot)
    }

    pub async fn frontend_snapshot_with_options(
        &self,
        options: FrontendSnapshotLoadOptions,
    ) -> Result<SessionFrontendSnapshotLoad> {
        // SQLite and git are synchronous. Keep all dashboard storage reads on
        // one connection and move that connection plus git subprocesses off
        // the async runtime workers. Load steering before the transcript so a
        // concurrently delivered record is either absent here or coverable by
        // the subsequent transcript scan, never rendered twice.
        let blocking_service = self.clone();
        let blocking_task = tokio::task::spawn_blocking(move || {
            blocking_service.load_frontend_snapshot_blocking(options)
        });
        let (active_threads, blocking) = tokio::join!(self.active_thread_names(), blocking_task);
        let blocking = blocking
            .map_err(|error| anyhow::anyhow!("frontend snapshot load task failed: {error}"))??;

        // Store-backed transcript reads (step 3): the snapshot blob (legacy
        // prefix) ++ the transcript log tail, ALWAYS. The agent-or-persisted
        // duality and the stale-during-run fallback are gone — mid-run
        // appends are visible as they commit to the log.
        self.update_transcript_scan().await?;
        let response_timing = {
            let snapshot = self.session_snapshot.lock().await;
            ResponseTimingSnapshot::from_session_snapshot(snapshot.as_ref())
        };
        let loaded_messages = match options.messages {
            FrontendSnapshotMessages::All => {
                let messages = self.store_backed_transcript().await?;
                let created_at = self.store_backed_transcript_times(messages.len()).await?;
                LoadedFrontendMessages {
                    messages,
                    created_at,
                    page: None,
                    cycle: None,
                }
            }
            FrontendSnapshotMessages::Page(request) => {
                let page = self.page_store_transcript(request).await?;
                let cycle = self.message_cycle_from_store().await?;
                LoadedFrontendMessages {
                    messages: page.messages,
                    created_at: page.created_at,
                    page: Some(page.page),
                    cycle: Some(cycle),
                }
            }
        };

        let covered_orchestrator_steering_ids = {
            let scan = self.lock_transcript_scan();
            covered_ids_from_scan(&blocking.thread_steering, &scan)
        };
        let mut metadata = self.metadata();
        metadata.extra_headers.clear();
        let transcript_warning = self
            .transcript_recovery_warning
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transcript_recovery_warning = match (
            blocking.run_recovery_warning.as_deref(),
            transcript_warning.as_deref(),
        ) {
            (Some(run_warning), Some(transcript_warning)) => {
                Some(format!("{run_warning}\n\n{transcript_warning}"))
            }
            (Some(run_warning), None) => Some(run_warning.to_string()),
            (None, warning) => warning.map(str::to_owned),
        };
        let snapshot = SessionFrontendSnapshot {
            metadata,
            messages: loaded_messages.messages,
            message_created_at: loaded_messages.created_at,
            transcript_recovery_warning,
            response_timing,
            active_run: self.active_run(),
            active_compaction: self.active_compaction(),
            sessions: blocking.sessions,
            active_threads,
            threads: blocking.threads,
            thread_episodes: blocking.thread_episodes,
            thread_events: blocking.thread_events.events,
            thread_event_boundary: blocking.thread_event_boundary,
            thread_event_diagnostics: blocking.thread_events.diagnostics,
            thread_steering: blocking.thread_steering,
            covered_orchestrator_steering_ids,
            worksets: blocking.worksets,
            workspace: blocking.workspace,
        };
        Ok(SessionFrontendSnapshotLoad {
            snapshot,
            message_page: loaded_messages.page,
            message_cycle: loaded_messages.cycle,
        })
    }
}
