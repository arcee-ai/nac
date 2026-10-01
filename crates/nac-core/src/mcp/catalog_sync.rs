use super::capabilities::{MAX_PROMPT_ARGUMENTS, MAX_PROMPT_NAME_CHARS};
use super::*;
use crate::events::McpNotificationKind;
use rmcp::service::{Peer, RoleClient};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex as StdMutex;
use std::time::Instant;

const MAX_DISCOVERED_PROMPTS: usize = 256;
const MAX_PROMPT_DISCOVERY_PAGES: usize = 32;
const MIN_REFRESH_INTERVAL: Duration = Duration::from_millis(100);

fn stable_catalog_name(
    server: &str,
    remote: &str,
    previous_names: &HashMap<String, String>,
    occupied: &mut HashSet<String>,
) -> String {
    if let Some(previous) = previous_names
        .get(remote)
        .filter(|name| occupied.insert((*name).clone()))
    {
        return previous.clone();
    }
    unique_tool_name(server, remote, occupied)
}

#[derive(Default)]
struct CatalogRefreshState {
    running: bool,
    pending: bool,
    generation: u64,
    completed: u64,
    last_started: Option<Instant>,
}

pub(super) struct McpCatalogRefreshGate {
    state: StdMutex<CatalogRefreshState>,
    progress: tokio::sync::watch::Sender<CatalogRefreshProgress>,
}

#[derive(Clone, Copy, Default)]
struct CatalogRefreshProgress {
    completed: u64,
    running: bool,
    generation: u64,
}

struct McpCatalogRefreshPermit<'a> {
    gate: &'a McpCatalogRefreshGate,
    running: bool,
}

struct McpCatalogRefreshWaiter {
    progress: tokio::sync::watch::Receiver<CatalogRefreshProgress>,
    target: u64,
    generation: u64,
}

enum McpCatalogRefreshRequest<'a> {
    Drive(McpCatalogRefreshPermit<'a>),
    Wait(McpCatalogRefreshWaiter),
}

impl Default for McpCatalogRefreshGate {
    fn default() -> Self {
        let (progress, _) = tokio::sync::watch::channel(CatalogRefreshProgress::default());
        Self {
            state: StdMutex::new(CatalogRefreshState::default()),
            progress,
        }
    }
}

impl McpCatalogRefreshGate {
    fn begin(&self, generation: u64) -> McpCatalogRefreshRequest<'_> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.running {
            let same_generation = state.generation == generation;
            if same_generation {
                state.pending = true;
            }
            return McpCatalogRefreshRequest::Wait(McpCatalogRefreshWaiter {
                progress: self.progress.subscribe(),
                target: state
                    .completed
                    .saturating_add(if same_generation { 2 } else { 1 }),
                generation,
            });
        }
        state.running = true;
        state.pending = false;
        state.generation = generation;
        self.progress.send_replace(CatalogRefreshProgress {
            completed: state.completed,
            running: true,
            generation,
        });
        McpCatalogRefreshRequest::Drive(McpCatalogRefreshPermit {
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
        state.completed = state.completed.saturating_add(1);
        let again = if state.pending {
            state.pending = false;
            true
        } else {
            state.running = false;
            self.running = false;
            false
        };
        self.gate.progress.send_replace(CatalogRefreshProgress {
            completed: state.completed,
            running: state.running,
            generation: state.generation,
        });
        again
    }
}

impl McpCatalogRefreshWaiter {
    async fn wait(mut self) -> bool {
        loop {
            let progress = *self.progress.borrow_and_update();
            if progress.completed >= self.target {
                return progress.generation == self.generation;
            }
            if !progress.running {
                return false;
            }
            if self.progress.changed().await.is_err() {
                return false;
            }
        }
    }
}

impl Drop for McpCatalogRefreshPermit<'_> {
    fn drop(&mut self) {
        if self.running {
            let mut state = self
                .gate
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.running = false;
            state.pending = false;
            self.gate.progress.send_replace(CatalogRefreshProgress {
                completed: state.completed,
                running: false,
                generation: state.generation,
            });
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
        let previous_names: HashMap<_, _> = current
            .tools
            .iter()
            .filter_map(|(name, binding)| {
                binding
                    .server
                    .upgrade()
                    .filter(|owner| owner.name == server.name)
                    .map(|_| (binding.tool_name.clone(), name.clone()))
            })
            .collect();
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
            if !server.config.exposes_tool(&tool.name) {
                continue;
            }
            let qualified_name =
                stable_catalog_name(&server.name, &tool.name, &previous_names, &mut occupied);
            let mut definition = tool_definition(&qualified_name, &server.name, &tool);
            definition.function.description =
                server.redactor.redact(&definition.function.description);
            if definition.function.description.len() > MAX_MCP_METADATA_BYTES {
                continue;
            }
            definition.function.parameters =
                match server.redactor.safe_value(Some(tool.input_schema.as_ref())) {
                    Some(value)
                        if value.get("_nac").and_then(Value::as_str)
                            != Some("metadata_limit_exceeded") =>
                    {
                        value
                    }
                    _ => continue,
                };
            let metadata = tool_metadata(&tool, &server.redactor);
            let approval = effective_tool_approval(&server.config, &tool);
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
                    metadata,
                    approval,
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
        let previous_names: HashMap<_, _> = current
            .prompt_commands
            .iter()
            .filter(|(_, command)| command.server_name == server.name)
            .map(|(name, command)| (command.prompt_name.clone(), name.clone()))
            .collect();
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
            let name =
                stable_catalog_name(&server.name, &prompt.name, &previous_names, &mut occupied);
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

    pub(super) async fn refresh_tools(self: &Arc<Self>, generation: u64, peer: &Peer<RoleClient>) {
        let gate = &self.tool_catalog_refresh;
        let mut permit = loop {
            if !self.is_current_connection_generation(generation) {
                return;
            }
            match gate.begin(generation) {
                McpCatalogRefreshRequest::Drive(permit) => break permit,
                McpCatalogRefreshRequest::Wait(waiter) => {
                    if waiter.wait().await {
                        return;
                    }
                }
            }
        };
        loop {
            if !self.is_current_connection_generation(generation) {
                return;
            }
            Self::wait_for_refresh_turn(gate).await;
            let result = timeout(self.catalog_timeout, peer.list_all_tools()).await;
            if !self.is_current_connection_generation(generation) {
                return;
            }
            match result {
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

    pub(super) async fn refresh_prompts(
        self: &Arc<Self>,
        generation: u64,
        peer: &Peer<RoleClient>,
    ) {
        let gate = &self.prompt_catalog_refresh;
        let mut permit = loop {
            if !self.is_current_connection_generation(generation) {
                return;
            }
            match gate.begin(generation) {
                McpCatalogRefreshRequest::Drive(permit) => break permit,
                McpCatalogRefreshRequest::Wait(waiter) => {
                    if waiter.wait().await {
                        return;
                    }
                }
            }
        };
        loop {
            if !self.is_current_connection_generation(generation) {
                return;
            }
            Self::wait_for_refresh_turn(gate).await;
            let result = timeout(self.catalog_timeout, list_bounded_prompts_peer(peer)).await;
            if !self.is_current_connection_generation(generation) {
                return;
            }
            match result {
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

    pub(super) async fn refresh_resources(
        self: &Arc<Self>,
        generation: u64,
        peer: &Peer<RoleClient>,
    ) {
        let gate = &self.resource_catalog_refresh;
        let mut permit = loop {
            if !self.is_current_connection_generation(generation) {
                return;
            }
            match gate.begin(generation) {
                McpCatalogRefreshRequest::Drive(permit) => break permit,
                McpCatalogRefreshRequest::Wait(waiter) => {
                    if waiter.wait().await {
                        return;
                    }
                }
            }
        };
        loop {
            if !self.is_current_connection_generation(generation) {
                return;
            }
            Self::wait_for_refresh_turn(gate).await;
            let result = timeout(self.catalog_timeout, peer.list_all_resources()).await;
            if !self.is_current_connection_generation(generation) {
                return;
            }
            match result {
                Ok(Ok(resources)) => {
                    self.sync
                        .set_resources(&self.name, bounded_resource_uris(resources));
                    self.sync.emit(
                        &self.name,
                        McpNotificationKind::CatalogRefreshed,
                        "resource catalog refreshed",
                    );
                    if self.protocol_version < ProtocolVersion::V_2026_07_28 {
                        self.reconcile_legacy_subscriptions(generation, peer).await;
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
    let mut prompts = Vec::new();
    let mut cursor = None;
    let mut seen_cursors = HashSet::new();
    for _ in 0..MAX_PROMPT_DISCOVERY_PAGES {
        let result = peer
            .list_prompts(Some(
                rmcp::model::PaginatedRequestParams::default().with_cursor(cursor.clone()),
            ))
            .await?;
        let remaining = MAX_DISCOVERED_PROMPTS.saturating_sub(prompts.len());
        prompts.extend(result.prompts.into_iter().take(remaining));
        if prompts.len() == MAX_DISCOVERED_PROMPTS {
            break;
        }
        let Some(next_cursor) = result.next_cursor else {
            break;
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            bail!("prompt discovery returned a repeated pagination cursor");
        }
        cursor = Some(next_cursor);
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
    fn refresh_keeps_prior_names_when_colliding_entries_reorder() {
        let previous = HashMap::from([
            (
                "alpha beta".to_string(),
                "mcp__docs__alpha_beta".to_string(),
            ),
            (
                "alpha-beta".to_string(),
                "mcp__docs__alpha_beta__2".to_string(),
            ),
        ]);
        let mut occupied = HashSet::new();

        let second = stable_catalog_name("docs", "alpha-beta", &previous, &mut occupied);
        let first = stable_catalog_name("docs", "alpha beta", &previous, &mut occupied);

        assert_eq!(second, "mcp__docs__alpha_beta__2");
        assert_eq!(first, "mcp__docs__alpha_beta");
    }

    #[tokio::test]
    async fn refresh_gate_coalesces_and_waits_for_one_trailing_turn() {
        let gate = McpCatalogRefreshGate::default();
        let McpCatalogRefreshRequest::Drive(mut permit) = gate.begin(1) else {
            panic!("first request must drive refresh");
        };
        let McpCatalogRefreshRequest::Wait(waiter) = gate.begin(1) else {
            panic!("concurrent request must wait");
        };
        assert!(matches!(gate.begin(1), McpCatalogRefreshRequest::Wait(_)));
        let mut waiting = Box::pin(waiter.wait());

        assert!(permit.finish_iteration());
        assert!(tokio::time::timeout(Duration::from_millis(1), &mut waiting)
            .await
            .is_err());
        assert!(!permit.finish_iteration());
        assert!(waiting.await);
        assert!(matches!(gate.begin(1), McpCatalogRefreshRequest::Drive(_)));
    }

    #[tokio::test]
    async fn dropping_refresh_driver_wakes_a_successor() {
        let gate = McpCatalogRefreshGate::default();
        let McpCatalogRefreshRequest::Drive(permit) = gate.begin(1) else {
            panic!("first request must drive refresh");
        };
        let McpCatalogRefreshRequest::Wait(waiter) = gate.begin(1) else {
            panic!("concurrent request must wait");
        };

        drop(permit);
        assert!(!waiter.wait().await);
        assert!(matches!(gate.begin(1), McpCatalogRefreshRequest::Drive(_)));
    }

    #[tokio::test]
    async fn newer_connection_waits_then_drives_its_own_refresh() {
        let gate = McpCatalogRefreshGate::default();
        let McpCatalogRefreshRequest::Drive(mut old) = gate.begin(1) else {
            panic!("old connection must drive its refresh");
        };
        let McpCatalogRefreshRequest::Wait(new) = gate.begin(2) else {
            panic!("new connection must wait for the old driver");
        };

        assert!(!old.finish_iteration());
        assert!(!new.wait().await);
        assert!(matches!(gate.begin(2), McpCatalogRefreshRequest::Drive(_)));
    }
}
