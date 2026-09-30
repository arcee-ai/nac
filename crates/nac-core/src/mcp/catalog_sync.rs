use super::capabilities::{MAX_PROMPT_ARGUMENTS, MAX_PROMPT_NAME_CHARS};
use super::*;
use crate::events::McpNotificationKind;
use rmcp::service::{Peer, RoleClient};
use std::collections::HashSet;
use std::sync::Mutex as StdMutex;
use std::time::Instant;

const MAX_DISCOVERED_PROMPTS: usize = 256;
const MIN_REFRESH_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Default)]
struct CatalogRefreshState {
    running: bool,
    pending: bool,
    last_started: Option<Instant>,
}

#[derive(Default)]
pub(super) struct McpCatalogRefreshGate {
    state: StdMutex<CatalogRefreshState>,
}

struct McpCatalogRefreshPermit<'a> {
    gate: &'a McpCatalogRefreshGate,
    running: bool,
}

impl McpCatalogRefreshGate {
    fn begin(&self) -> Option<McpCatalogRefreshPermit<'_>> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.running {
            state.pending = true;
            return None;
        }
        state.running = true;
        state.pending = false;
        Some(McpCatalogRefreshPermit {
            gate: self,
            running: true,
        })
    }

    fn delay(&self) -> Duration {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .last_started
            .map(|started| MIN_REFRESH_INTERVAL.saturating_sub(started.elapsed()))
            .unwrap_or_default()
    }

    fn mark_started(&self) {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .last_started = Some(Instant::now());
    }
}

impl McpCatalogRefreshPermit<'_> {
    fn finish_iteration(&mut self) -> bool {
        let mut state = self
            .gate
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.pending {
            state.pending = false;
            true
        } else {
            state.running = false;
            self.running = false;
            false
        }
    }
}

impl Drop for McpCatalogRefreshPermit<'_> {
    fn drop(&mut self) {
        if self.running {
            self.gate
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .running = false;
        }
    }
}

impl McpSyncState {
    pub(super) fn replace_tools(&self, server: &Arc<McpServer>, tools: Vec<Tool>) {
        let mut snapshot = self
            .snapshot
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let current = snapshot.clone();
        let mut next_tools = current.tools.clone();
        next_tools.retain(|_, binding| {
            binding
                .server
                .upgrade()
                .is_some_and(|owner| owner.name != server.name)
        });
        let mut occupied: HashSet<String> = next_tools
            .keys()
            .chain(current.prompt_commands.keys())
            .cloned()
            .collect();
        for tool in tools {
            let qualified_name = unique_tool_name(&server.name, &tool.name, &mut occupied);
            let mut definition = tool_definition(&qualified_name, &server.name, &tool);
            if definition.function.parameters["properties"]
                .as_object()
                .is_some_and(|properties| properties.contains_key("_nac"))
                || crate::tools::kernel::decorate_timeout_schema(
                    &mut definition.function.parameters,
                )
                .is_err()
            {
                continue;
            }
            next_tools.insert(
                qualified_name,
                Arc::new(McpToolBinding {
                    tool_name: tool.name.to_string(),
                    definition,
                    server: Arc::downgrade(server),
                    execution_timeout: server.execution_timeout,
                }),
            );
        }
        *snapshot = Arc::new(McpCatalogSnapshot {
            tools: next_tools,
            prompt_commands: current.prompt_commands.clone(),
        });
    }

    pub(super) fn replace_prompts(
        &self,
        server: &Arc<McpServer>,
        prompts: Vec<rmcp::model::Prompt>,
    ) {
        let mut snapshot = self
            .snapshot
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let current = snapshot.clone();
        let mut commands = current.prompt_commands.clone();
        commands.retain(|_, command| command.server_name != server.name);
        let mut occupied: HashSet<String> = current
            .tools
            .keys()
            .chain(commands.keys())
            .cloned()
            .collect();
        for prompt in prompts {
            if prompt.name.is_empty()
                || prompt.name.chars().count() > MAX_PROMPT_NAME_CHARS
                || prompt.arguments.as_ref().is_some_and(|arguments| {
                    arguments.len() > MAX_PROMPT_ARGUMENTS
                        || arguments.iter().any(|argument| {
                            argument.name.is_empty()
                                || argument.name.chars().count() > MAX_PROMPT_NAME_CHARS
                        })
                })
            {
                continue;
            }
            let name = unique_tool_name(&server.name, &prompt.name, &mut occupied);
            commands.insert(
                name.clone(),
                McpPromptCommand::from_prompt(name, server.name.clone(), prompt),
            );
        }
        *snapshot = Arc::new(McpCatalogSnapshot {
            tools: current.tools.clone(),
            prompt_commands: commands,
        });
    }
}

impl McpServer {
    async fn wait_for_refresh_turn(gate: &McpCatalogRefreshGate) {
        let delay = gate.delay();
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        gate.mark_started();
    }

    pub(super) async fn refresh_tools(self: &Arc<Self>, peer: &Peer<RoleClient>) {
        let gate = &self.tool_catalog_refresh;
        let Some(mut permit) = gate.begin() else {
            return;
        };
        loop {
            Self::wait_for_refresh_turn(gate).await;
            match timeout(self.catalog_timeout, peer.list_all_tools()).await {
                Ok(Ok(tools)) => {
                    self.sync.replace_tools(self, tools);
                    self.sync.emit(
                        &self.name,
                        McpNotificationKind::CatalogRefreshed,
                        "tool catalog refreshed",
                    );
                }
                Ok(Err(error)) => self.refresh_failed("tool", error.to_string()),
                Err(_) => self.refresh_failed("tool", "refresh timed out".to_string()),
            }
            if !permit.finish_iteration() {
                break;
            }
        }
    }

    pub(super) async fn refresh_prompts(self: &Arc<Self>, peer: &Peer<RoleClient>) {
        let gate = &self.prompt_catalog_refresh;
        let Some(mut permit) = gate.begin() else {
            return;
        };
        loop {
            Self::wait_for_refresh_turn(gate).await;
            match timeout(self.catalog_timeout, list_bounded_prompts_peer(peer)).await {
                Ok(Ok(prompts)) => {
                    self.sync.replace_prompts(self, prompts);
                    self.sync.emit(
                        &self.name,
                        McpNotificationKind::CatalogRefreshed,
                        "prompt catalog refreshed",
                    );
                }
                Ok(Err(error)) => self.refresh_failed("prompt", format!("{error:#}")),
                Err(_) => self.refresh_failed("prompt", "refresh timed out".to_string()),
            }
            if !permit.finish_iteration() {
                break;
            }
        }
    }

    pub(super) async fn refresh_resources(self: &Arc<Self>, peer: &Peer<RoleClient>) {
        let gate = &self.resource_catalog_refresh;
        let Some(mut permit) = gate.begin() else {
            return;
        };
        loop {
            Self::wait_for_refresh_turn(gate).await;
            match timeout(self.catalog_timeout, peer.list_all_resources()).await {
                Ok(Ok(resources)) => {
                    self.sync
                        .set_resources(&self.name, bounded_resource_uris(resources));
                    self.sync.emit(
                        &self.name,
                        McpNotificationKind::CatalogRefreshed,
                        "resource catalog refreshed",
                    );
                    if self.protocol_version < ProtocolVersion::V_2026_07_28 {
                        self.reconcile_legacy_subscriptions(peer).await;
                    }
                }
                Ok(Err(error)) => self.refresh_failed("resource", error.to_string()),
                Err(_) => self.refresh_failed("resource", "refresh timed out".to_string()),
            }
            if !permit.finish_iteration() {
                break;
            }
        }
    }

    fn refresh_failed(&self, catalog: &str, error: String) {
        self.sync.emit(
            &self.name,
            McpNotificationKind::CatalogRefreshFailed,
            format!(
                "{catalog} catalog refresh failed; retaining last-known-good snapshot: {error}"
            ),
        );
    }
}

async fn list_bounded_prompts_peer(peer: &Peer<RoleClient>) -> Result<Vec<rmcp::model::Prompt>> {
    let prompts = peer.list_all_prompts().await?;
    if prompts.len() > MAX_DISCOVERED_PROMPTS {
        bail!("prompt catalog exceeds the {MAX_DISCOVERED_PROMPTS}-entry bound");
    }
    Ok(prompts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_names_reserve_existing_prompt_commands() {
        let mut occupied = HashSet::from(["mcp__docs__search".to_string()]);

        assert_eq!(
            unique_tool_name("docs", "search", &mut occupied),
            "mcp__docs__search__2"
        );
    }

    #[test]
    fn refresh_gate_coalesces_concurrent_requests_into_one_trailing_turn() {
        let gate = McpCatalogRefreshGate::default();
        let mut permit = gate.begin().expect("first request drives refresh");
        assert!(gate.begin().is_none());
        assert!(gate.begin().is_none());
        assert!(permit.finish_iteration());
        assert!(!permit.finish_iteration());
        assert!(gate.begin().is_some());
    }

    #[test]
    fn dropping_refresh_driver_releases_the_gate() {
        let gate = McpCatalogRefreshGate::default();
        let permit = gate.begin().expect("first request drives refresh");
        assert!(gate.begin().is_none());
        drop(permit);
        assert!(gate.begin().is_some());
    }
}
