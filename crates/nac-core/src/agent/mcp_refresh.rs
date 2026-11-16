use super::*;
use crate::mcp::{McpRootPolicy, McpTransportPolicy, SessionMcpRefreshState};

impl Agent {
    pub(crate) fn mcp_mounts(&self) -> Arc<crate::mcp::SessionMcpMounts> {
        Arc::clone(&self.mcp_mounts)
    }

    /// Runs only between completed tool rounds, never from a dashboard
    /// connection callback or while a captured tool is waiting for approval.
    pub(super) async fn admit_mcp_mount_refresh(&mut self) -> Result<()> {
        if self.mode == AgentMode::Orchestrator {
            return Ok(());
        }
        let Some(session) = self.tool_runtime.session_id.clone() else {
            return Ok(());
        };
        let store = self.tool_runtime.store_path.clone();
        let request = crate::store::call_legacy_store(&store.clone(), move || {
            crate::store::load_session_mcp_refresh(&store, &session)
        })
        .await??;
        if request.revision <= self.mcp_mounts.revision() {
            if let Some(failure) = self.mcp_mounts.failure() {
                return Err(anyhow!(failure));
            }
            return Ok(());
        }
        let remote = matches!(
            self.tool_runtime.backend.as_ref(),
            crate::sandbox::ExecutionBackend::Ssh(_)
        );
        let paths = crate::paths::PathContext::new(if remote {
            &self.tool_runtime.config_cwd
        } else {
            &self.tool_runtime.workspace_cwd
        });
        let source = crate::mcp::mount_source_revision(&paths);
        let outcome = match source.as_ref() {
            Ok(_) => {
                let sandbox = self.sandbox_session();
                let load = McpRegistry::load_reporting_skips(
                    &self.tool_runtime.workspace_cwd,
                    sandbox.as_ref(),
                    &paths,
                    if remote {
                        McpTransportPolicy::StreamableHttpOnly
                    } else {
                        McpTransportPolicy::All
                    },
                    if remote {
                        McpRootPolicy::None
                    } else {
                        McpRootPolicy::Workspace
                    },
                );
                let cancellation = self.command_cancellation();
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => return Err(anyhow!("integration refresh cancelled before model admission")),
                    outcome = load => outcome,
                }
            }
            Err(_) => Err(anyhow!("MCP configuration is unreadable")),
        };
        let latest_store = self.tool_runtime.store_path.clone();
        let latest_session = self.tool_runtime.session_id.clone().unwrap_or_default();
        let latest = crate::store::call_legacy_store(&latest_store.clone(), move || {
            crate::store::load_session_mcp_refresh(&latest_store, &latest_session)
        })
        .await??;
        let expected_source = source.ok();
        let unchanged = expected_source
            .zip(crate::mcp::mount_source_revision(&paths).ok())
            .is_some_and(|(before, after)| before == after);
        let loaded_source_changed = outcome
            .as_ref()
            .is_ok_and(|loaded| loaded.source_revision != expected_source);
        let (registry, state, message) = match outcome {
            Ok(outcome)
                if unchanged
                    && outcome.source_revision == expected_source
                    && latest.revision == request.revision =>
            {
                let degraded = !outcome.skipped.is_empty();
                (outcome.registry, if degraded { SessionMcpRefreshState::Degraded } else { SessionMcpRefreshState::Current },
                 degraded.then(|| "Some integrations could not mount. Review MCP settings, connect or repair them, then refresh again.".to_string()))
            }
            _ => {
                let message = if latest.revision != request.revision {
                    "A newer integration refresh is pending. Submit again to admit its settings before the next model request."
                } else if !unchanged || loaded_source_changed {
                    "Integration configuration or connection state changed or is unreadable. Review MCP settings and refresh again."
                } else {
                    "A required integration could not mount. Check its connection, credentials and tool settings, then refresh again."
                };
                (
                    None,
                    SessionMcpRefreshState::Failed,
                    Some(message.to_string()),
                )
            }
        };
        // Drop only our ownership. Existing request snapshots/captures keep
        // their old server, definition, resource and approval policy alive.
        self.tool_runtime.mcp = registry.clone();
        self.tool_runtime.mcp_tools = Arc::new(HashMap::new());
        self.fallback_tool_defs.clone_from(&self.base_tool_defs);
        self.mcp_observation = registry
            .as_ref()
            .map(|mcp| mcp.register_event_sink(self.event_sink.clone(), self.thread_name.clone()));
        self.mcp_mounts
            .install(request.revision, registry, state, message.clone());
        if let Some(message) = message {
            self.emit(AgentEvent::McpServerSkipped {
                thread_name: self.thread_name.clone(),
                server_name: "session integrations".to_string(),
                reason: message,
            })
            .await;
        } else {
            self.emit(AgentEvent::McpNotification {
                thread_name: self.thread_name.clone(),
                server_name: "session integrations".to_string(),
                kind: crate::events::McpNotificationKind::CatalogRefreshed,
                message: format!(
                    "Session mount refresh revision {} applied",
                    request.revision
                ),
            })
            .await;
        }
        if let Some(failure) = self.mcp_mounts.failure() {
            return Err(anyhow!(failure));
        }
        Ok(())
    }

    /// Instructions are a projection of the mounted capabilities, not a
    /// transcript edit. Historical conversations keep their original bytes.
    pub(super) fn project_mcp_instructions(&self, messages: &mut [Message]) {
        if self.mcp_mounts.revision() == 0 {
            return;
        }
        let Some(Message::System { content }) = messages.first_mut() else {
            return;
        };
        const OPEN: &str = "<mcp_server_instructions server=";
        const CLOSE: &str = "</mcp_server_instructions>";
        let preamble = crate::mcp::capabilities::INSTRUCTION_PREAMBLE;
        if let Some(start) = content.find(preamble) {
            let mut end = start + preamble.len();
            loop {
                let tail = &content[end..];
                let next = tail.trim_start();
                if !next.starts_with(OPEN) {
                    break;
                }
                let Some(close) = next.find(CLOSE) else {
                    break;
                };
                end += tail.len() - next.len() + close + CLOSE.len();
            }
            if end > start + preamble.len() {
                content.replace_range(start..end, "");
            }
        }
        if let Some(instructions) = self
            .tool_runtime
            .mcp
            .as_ref()
            .and_then(|mcp| mcp.instructions_message())
        {
            content.push_str("\n\n");
            content.push_str(&instructions);
        }
    }
}
