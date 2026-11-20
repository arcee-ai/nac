use super::*;

impl SessionService {
    pub fn list_sessions(&self) -> Result<Vec<SessionSummarySnapshot>> {
        view::list_sessions(&self.metadata.store_path)
    }

    fn load_primary_tool_events_with_connection(
        &self,
        conn: &rusqlite::Connection,
        per_thread_limit: usize,
    ) -> Result<DecodedThreadEvents> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(DecodedThreadEvents {
                primary_tool_events: Vec::new(),
                diagnostics: Vec::new(),
            });
        };
        let records = crate::store::load_primary_tool_events_with_connection(
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

        let store = &self.metadata.store_path;
        let session_id = self.metadata.session_id.as_deref();
        let projection = if let Some(owner) = crate::store::coordinator::owner_for(store)? {
            owner.check_blocking_context()?;
            // Event publication waits for its SQL command while holding the
            // event boundary. The executor reads only durable records, never
            // this lock, so queue saturation cannot invert that order.
            let (boundary, mut projection) = self.event_bus.thread_event_boundary(|| {
                owner
                    .submit(ReadFrontendProjection {
                        session_id: session_id.map(str::to_owned),
                        options,
                    })?
                    .acknowledge_blocking()?
            })?;
            projection.thread_event_boundary = Some(boundary);
            projection
        } else {
            // Keep legacy checkout-before-event-lock ordering for standalone
            // and cross-process characterization fixtures.
            let connection = crate::store::open_runtime_connection(store)?;
            read_stored_projection(&connection, session_id, options, || {
                self.event_bus
                    .thread_event_boundary(|| {
                        self.load_primary_tool_events_with_connection(
                            &connection,
                            options.thread_event_limit,
                        )
                    })
                    .map(|(boundary, events)| (Some(boundary), events))
            })?
        };
        let StoredFrontendProjection {
            sessions,
            thread_events,
            thread_event_boundary,
            run_failure,
            forks,
        } = projection;
        let thread_event_boundary = thread_event_boundary.ok_or_else(|| {
            anyhow::anyhow!("frontend persistence projection omitted its event boundary")
        })?;
        Ok(FrontendSnapshotBlockingLoad {
            sessions,
            thread_events,
            thread_event_boundary,
            forks,
            run_failure,
            workspace,
        })
    }
}

fn decode_thread_events(records: Vec<crate::store::ThreadEventRecord>) -> DecodedThreadEvents {
    let mut primary_tool_events = Vec::new();
    let mut diagnostics = Vec::new();
    for record in records {
        if let Some(
            event @ (AgentEvent::ToolCallStarted { .. } | AgentEvent::ToolCallFinished { .. }),
        ) = decode_thread_event(record, &mut diagnostics)
        {
            primary_tool_events.push(event);
        }
    }
    DecodedThreadEvents {
        primary_tool_events,
        diagnostics,
    }
}

impl SessionService {
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
        let shell_commands = if self.metadata.session_id.is_some() {
            self.shell_commands().await?
        } else {
            Vec::new()
        };
        // SQLite and git are synchronous. Keep all dashboard storage reads on
        // one connection and move that connection plus git subprocesses off
        // the async runtime workers. Load steering before the transcript so a
        // concurrently delivered record is either absent here or coverable by
        // the subsequent transcript scan, never rendered twice.
        let blocking_service = self.clone();
        let blocking_task = crate::store::spawn_blocking_store_caller(move || {
            blocking_service.load_frontend_snapshot_blocking(options)
        });
        let blocking = blocking_task
            .await
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
                let (canonical_message_indices, messages, tool_call_occurrences) =
                    self.all_store_transcript_with_occurrences().await?;
                let (created_at, terminal_selection_attributions) =
                    self.store_backed_transcript_metadata(&messages).await?;
                LoadedFrontendMessages {
                    canonical_message_indices,
                    tool_call_occurrences,
                    terminal_selection_attributions,
                    messages,
                    created_at,
                    page: None,
                    cycle: None,
                }
            }
            FrontendSnapshotMessages::Page(request) => {
                let page = self.page_store_transcript(request).await?;
                let cycle = self.message_cycle_from_store();
                LoadedFrontendMessages {
                    canonical_message_indices: page.canonical_message_indices,
                    tool_call_occurrences: page.tool_call_occurrences,
                    terminal_selection_attributions: page.terminal_selection_attributions,
                    messages: page.messages,
                    created_at: page.created_at,
                    page: Some(page.page),
                    cycle: Some(cycle),
                }
            }
        };

        let mut metadata = self.metadata();
        metadata.extra_headers.clear();
        let transcript_warning = self
            .transcript_recovery_warning
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transcript_recovery_warning = transcript_warning.as_deref().map(str::to_owned);
        let snapshot = SessionFrontendSnapshot {
            metadata,
            messages: loaded_messages.messages,
            message_created_at: loaded_messages.created_at,
            transcript_recovery_warning,
            run_failure: blocking.run_failure,
            response_timing,
            active_run: self.active_run(),
            active_compaction: self.active_compaction(),
            shell_commands,
            sessions: blocking.sessions,
            primary_tool_events: blocking.thread_events.primary_tool_events,
            thread_event_boundary: blocking.thread_event_boundary,
            thread_event_diagnostics: blocking.thread_events.diagnostics,
            forks: blocking.forks,
            workspace: blocking.workspace,
        };
        Ok(SessionFrontendSnapshotLoad {
            canonical_message_indices: loaded_messages.canonical_message_indices,
            tool_call_occurrences: loaded_messages.tool_call_occurrences,
            terminal_selection_attributions: loaded_messages.terminal_selection_attributions,
            snapshot,
            message_page: loaded_messages.page,
            message_cycle: loaded_messages.cycle,
        })
    }
}

struct StoredFrontendProjection {
    sessions: Vec<SessionSummarySnapshot>,
    thread_events: DecodedThreadEvents,
    thread_event_boundary: Option<SessionEventBoundary>,
    forks: Vec<crate::store::SessionForkLink>,
    run_failure: Option<crate::run_failure::RunFailure>,
}

fn read_stored_projection(
    conn: &rusqlite::Connection,
    session_id: Option<&str>,
    options: FrontendSnapshotLoadOptions,
    load_events: impl FnOnce() -> Result<(Option<SessionEventBoundary>, DecodedThreadEvents)>,
) -> Result<StoredFrontendProjection> {
    let sessions = if options.include_sessions {
        view::list_sessions_with_connection(conn)?
    } else {
        Vec::new()
    };
    let (thread_event_boundary, thread_events) = load_events()?;
    let forks = session_id
        .map(|session_id| crate::store::list_session_forks_with_connection(conn, session_id))
        .transpose()?
        .unwrap_or_default();
    let run_failure = session_id
        .map(|session_id| crate::store::load_run_recovery_with_connection(conn, session_id))
        .transpose()?
        .flatten()
        .and_then(|record| match record.status {
            crate::store::RunRecoveryStatus::Active => None,
            crate::store::RunRecoveryStatus::Interrupted => Some(
                crate::run_failure::RunFailure::interrupted(INTERRUPTED_RUN_WARNING),
            ),
            crate::store::RunRecoveryStatus::Failed => Some(
                record
                    .failure
                    .unwrap_or_else(|| crate::run_failure::RunFailure::unknown(FAILED_RUN_WARNING)),
            ),
        });

    Ok(StoredFrontendProjection {
        sessions,
        thread_events,
        thread_event_boundary,
        run_failure,
        forks,
    })
}

struct ReadFrontendProjection {
    session_id: Option<String>,
    options: FrontendSnapshotLoadOptions,
}
impl crate::store::coordinator::PersistenceCommand for ReadFrontendProjection {
    type Output = Result<StoredFrontendProjection>;
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(self.session_id.as_deref())
    }
    fn outcome(output: &Self::Output) -> crate::telemetry::TelemetryOutcome {
        if output.is_ok() {
            crate::telemetry::TelemetryOutcome::Ok
        } else {
            crate::telemetry::TelemetryOutcome::Error
        }
    }
    fn error_identity(output: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
        crate::store::coordinator::CommandOutput::error_identity(output)
    }
    fn execute(self, path: &std::path::Path) -> Result<Self::Output> {
        let connection = crate::store::open_runtime_connection(path)?;
        let session_id = self.session_id.as_deref();
        Ok(read_stored_projection(
            &connection,
            session_id,
            self.options,
            || {
                let records = session_id
                    .map(|session_id| {
                        crate::store::load_primary_tool_events_with_connection(
                            &connection,
                            session_id,
                            self.options.thread_event_limit,
                        )
                    })
                    .transpose()?
                    .unwrap_or_default();
                Ok((None, decode_thread_events(records)))
            },
        ))
    }
}
