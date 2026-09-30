use super::capabilities::{MAX_PROMPT_ARGUMENTS, MAX_PROMPT_NAME_CHARS};
use super::*;
use crate::events::{AgentEvent, EventSink, McpNotificationKind};
use rmcp::model::{
    LoggingMessageNotificationParam, ProgressNotificationParam, ResourceUpdatedNotificationParam,
    ServerNotification, SubscribeRequestParams, SubscriptionFilter, UnsubscribeRequestParams,
};
use rmcp::service::{NotificationContext, Peer, RoleClient};
use std::collections::{HashMap, HashSet};
use std::num::NonZeroUsize;
use std::sync::{Mutex as StdMutex, OnceLock, RwLock as StdRwLock, Weak};
use std::time::Instant;
use tokio::task::JoinHandle;
const MAX_DISCOVERED_PROMPTS: usize = 256;

const MAX_SUBSCRIBED_RESOURCES: usize = 256;
const SUBSCRIPTION_CHANNEL_CAPACITY: usize = 64;
const MIN_REFRESH_INTERVAL: Duration = Duration::from_millis(100);
const MIN_OBSERVATION_INTERVAL: Duration = Duration::from_millis(100);
const MAX_OBSERVATION_CHARS: usize = 600;

#[derive(Default)]
pub(super) struct McpCatalogSnapshot {
    pub(super) tools: HashMap<String, Arc<McpToolBinding>>,
    pub(super) prompt_commands: HashMap<String, McpPromptCommand>,
}

#[derive(Clone, Default)]
struct ObservationTarget {
    sink: EventSink,
    thread_name: Option<String>,
}

pub(super) struct McpSyncState {
    snapshot: StdRwLock<Arc<McpCatalogSnapshot>>,
    resources: StdRwLock<HashMap<String, Vec<String>>>,
    target: StdRwLock<ObservationTarget>,
    redactions: StdRwLock<HashMap<String, Vec<String>>>,
    last_observation: StdMutex<HashMap<(String, McpNotificationKind), Instant>>,
    recent_resource_updates: StdMutex<HashMap<(String, String), Instant>>,
}

#[derive(Default)]
pub(super) struct McpNotificationTask {
    task: StdMutex<Option<JoinHandle<()>>>,
}

impl McpNotificationTask {
    fn replace(&self, task: JoinHandle<()>) {
        let previous = self
            .task
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .replace(task);
        if let Some(previous) = previous {
            previous.abort();
        }
    }

    fn abort(&self) {
        let task = self
            .task
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(task) = task {
            task.abort();
        }
    }
}

impl Drop for McpNotificationTask {
    fn drop(&mut self) {
        self.abort();
    }
}

impl McpSyncState {
    pub(super) fn new() -> Self {
        Self {
            snapshot: StdRwLock::new(Arc::new(McpCatalogSnapshot::default())),
            resources: StdRwLock::new(HashMap::new()),
            target: StdRwLock::new(ObservationTarget::default()),
            redactions: StdRwLock::new(HashMap::new()),
            last_observation: StdMutex::new(HashMap::new()),
            recent_resource_updates: StdMutex::new(HashMap::new()),
        }
    }

    pub(super) fn initialize(
        &self,
        tools: HashMap<String, Arc<McpToolBinding>>,
        prompt_commands: HashMap<String, McpPromptCommand>,
    ) {
        *self
            .snapshot
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Arc::new(McpCatalogSnapshot {
            tools,
            prompt_commands,
        });
    }

    pub(super) fn snapshot(&self) -> Arc<McpCatalogSnapshot> {
        self.snapshot
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub(super) fn set_target(&self, sink: EventSink, thread_name: Option<String>) {
        *self
            .target
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            ObservationTarget { sink, thread_name };
    }

    pub(super) fn set_redactions(&self, server: &str, values: Vec<String>) {
        self.redactions
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(server.to_string(), values);
    }

    pub(super) fn set_resources(&self, server: &str, uris: Vec<String>) {
        let mut bounded = Vec::new();
        for uri in uris.into_iter().take(MAX_SUBSCRIBED_RESOURCES) {
            if !uri.is_empty() && !bounded.contains(&uri) {
                bounded.push(uri);
            }
        }
        self.resources
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(server.to_string(), bounded);
    }

    pub(super) fn resources(&self, server: &str) -> Vec<String> {
        self.resources
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(server)
            .cloned()
            .unwrap_or_default()
    }

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
        let mut occupied: HashSet<String> = next_tools.keys().cloned().collect();
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

    pub(super) fn emit(&self, server: &str, kind: McpNotificationKind, message: impl AsRef<str>) {
        let now = Instant::now();
        {
            let mut last = self
                .last_observation
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if last
                .get(&(server.to_string(), kind))
                .is_some_and(|previous| now.duration_since(*previous) < MIN_OBSERVATION_INTERVAL)
            {
                return;
            }
            last.insert((server.to_string(), kind), now);
        }
        let redactions = self
            .redactions
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(server)
            .cloned()
            .unwrap_or_default();
        let redaction_refs: Vec<&str> = redactions.iter().map(String::as_str).collect();
        let redacted = crate::model::redact_credentials(message.as_ref(), &redaction_refs);
        let bounded: String = redacted.chars().take(MAX_OBSERVATION_CHARS).collect();
        let target = self
            .target
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        target.sink.emit(AgentEvent::McpNotification {
            thread_name: target.thread_name,
            server_name: server.to_string(),
            kind,
            message: bounded,
        });
    }

    pub(super) fn emit_resource_update(&self, server: &str, uri: &str) {
        let now = Instant::now();
        {
            let mut recent = self
                .recent_resource_updates
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            recent.retain(|_, seen| now.duration_since(*seen) < MIN_OBSERVATION_INTERVAL);
            let key = (server.to_string(), uri.to_string());
            if recent.contains_key(&key) {
                return;
            }
            if recent.len() >= MAX_SUBSCRIBED_RESOURCES {
                recent.clear();
            }
            recent.insert(key, now);
        }
        self.emit(server, McpNotificationKind::ResourceUpdated, uri);
    }
}

fn unique_tool_name(server: &str, remote: &str, occupied: &mut HashSet<String>) -> String {
    let mut seen = HashMap::new();
    let base = allocate_tool_name(server, remote, &mut seen);
    if occupied.insert(base.clone()) {
        return base;
    }
    for suffix in 2usize.. {
        let candidate = format!("{base}__{suffix}");
        if occupied.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!("usize name suffix space is finite but cannot be exhausted")
}

#[derive(Default)]
pub(super) struct McpHandlerBinding {
    server: OnceLock<Weak<McpServer>>,
}

impl McpHandlerBinding {
    pub(super) fn bind(&self, server: &Arc<McpServer>) {
        let _ = self.server.set(Arc::downgrade(server));
    }

    fn server(&self) -> Option<Arc<McpServer>> {
        self.server.get().and_then(Weak::upgrade)
    }
}

impl NacMcpClientHandler {
    pub(super) fn bind(&self, server: &Arc<McpServer>) {
        self.binding.bind(server);
    }

    pub(super) fn unbound(roots: Vec<Root>) -> Self {
        Self {
            roots,
            binding: Arc::new(McpHandlerBinding::default()),
        }
    }

    pub(super) fn observe_progress(&self, params: ProgressNotificationParam) {
        if let Some(server) = self.binding.server() {
            server.observe_progress(params);
        }
    }

    pub(super) fn observe_log(&self, params: LoggingMessageNotificationParam) {
        if let Some(server) = self.binding.server() {
            server.observe_log(params);
        }
    }

    pub(super) fn observe_resource_update(&self, params: ResourceUpdatedNotificationParam) {
        if let Some(server) = self.binding.server() {
            server.sync.emit_resource_update(&server.name, &params.uri);
        }
    }

    pub(super) async fn refresh_resources(&self, context: NotificationContext<RoleClient>) {
        if let Some(server) = self.binding.server() {
            server.refresh_resources(&context.peer).await;
        }
    }

    pub(super) async fn refresh_tools(&self, context: NotificationContext<RoleClient>) {
        if let Some(server) = self.binding.server() {
            server.refresh_tools(&context.peer).await;
        }
    }

    pub(super) async fn refresh_prompts(&self, context: NotificationContext<RoleClient>) {
        if let Some(server) = self.binding.server() {
            server.refresh_prompts(&context.peer).await;
        }
    }
}

impl McpServer {
    fn refresh_allowed(&self, catalog: &'static str) -> bool {
        let now = Instant::now();
        let mut last = self
            .last_catalog_refresh
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if last
            .get(catalog)
            .is_some_and(|previous| now.duration_since(*previous) < MIN_REFRESH_INTERVAL)
        {
            return false;
        }
        last.insert(catalog, now);
        true
    }

    async fn refresh_tools(self: &Arc<Self>, peer: &Peer<RoleClient>) {
        if !self.refresh_allowed("tools") {
            return;
        }
        let _refresh = self.catalog_refresh.lock().await;
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
    }

    async fn refresh_prompts(self: &Arc<Self>, peer: &Peer<RoleClient>) {
        if !self.refresh_allowed("prompts") {
            return;
        }
        let _refresh = self.catalog_refresh.lock().await;
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
    }

    async fn refresh_resources(self: &Arc<Self>, peer: &Peer<RoleClient>) {
        if !self.refresh_allowed("resources") {
            return;
        }
        let _refresh = self.catalog_refresh.lock().await;
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

    async fn reconcile_legacy_subscriptions(&self, peer: &Peer<RoleClient>) {
        if !self
            .capabilities
            .resources
            .as_ref()
            .is_some_and(|resources| resources.subscribe == Some(true))
        {
            return;
        }
        let wanted: HashSet<String> = self.sync.resources(&self.name).into_iter().collect();
        let current = self
            .legacy_subscriptions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        for uri in wanted.difference(&current) {
            if peer
                .subscribe(SubscribeRequestParams::new(uri.clone()))
                .await
                .is_ok()
            {
                self.legacy_subscriptions
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .insert(uri.clone());
            }
        }
        for uri in current.difference(&wanted) {
            let _ = peer
                .unsubscribe(UnsubscribeRequestParams::new(uri.clone()))
                .await;
            self.legacy_subscriptions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(uri);
        }
    }

    async fn process_notification(
        self: &Arc<Self>,
        notification: ServerNotification,
        peer: &Peer<RoleClient>,
    ) -> bool {
        match notification {
            ServerNotification::ToolListChangedNotification(_) => self.refresh_tools(peer).await,
            ServerNotification::PromptListChangedNotification(_) => {
                self.refresh_prompts(peer).await;
            }
            ServerNotification::ResourceListChangedNotification(_) => {
                self.refresh_resources(peer).await;
                return self.protocol_version >= ProtocolVersion::V_2026_07_28;
            }
            ServerNotification::ResourceUpdatedNotification(notification) => self
                .sync
                .emit_resource_update(&self.name, &notification.params.uri),
            ServerNotification::ProgressNotification(notification) => {
                self.observe_progress(notification.params);
            }
            ServerNotification::LoggingMessageNotification(notification) => {
                self.observe_log(notification.params);
            }
            _ => {}
        }
        false
    }

    fn observe_progress(&self, params: ProgressNotificationParam) {
        let total = params
            .total
            .map(|total| format!("/{total}"))
            .unwrap_or_default();
        self.sync.emit(
            &self.name,
            McpNotificationKind::Progress,
            format!(
                "{}{} {}",
                params.progress,
                total,
                params.message.unwrap_or_default()
            ),
        );
    }

    fn observe_log(&self, params: LoggingMessageNotificationParam) {
        let data = serde_json::to_string(&params.data)
            .unwrap_or_else(|_| "\"unserializable MCP log payload\"".to_string());
        self.sync.emit(
            &self.name,
            McpNotificationKind::Log,
            format!("{:?} {data}", params.level),
        );
    }

    pub(super) async fn start_notification_processing(self: &Arc<Self>) {
        self.notification_task.abort();
        self.reset_legacy_subscriptions();
        let service = self.current_service().await;
        let peer = service.read().await.peer().clone();
        if self.should_seed_resources() {
            self.refresh_resources(&peer).await;
        }
        if self.protocol_version < ProtocolVersion::V_2026_07_28 {
            return;
        }
        let weak = Arc::downgrade(self);
        let task = tokio::spawn(async move {
            run_subscription(weak, peer).await;
        });
        self.notification_task.replace(task);
    }

    fn subscription_filter(&self) -> SubscriptionFilter {
        let mut filter = SubscriptionFilter::new();
        filter.tools_list_changed = Some(true);
        filter.prompts_list_changed = Some(true);
        filter.resources_list_changed = Some(true);
        filter.resource_subscriptions = Some(self.sync.resources(&self.name));
        filter.supported_by(&self.capabilities)
    }
}

async fn run_subscription(server: Weak<McpServer>, peer: Peer<RoleClient>) {
    loop {
        let Some(current) = server.upgrade() else {
            return;
        };
        let filter = current.subscription_filter();
        drop(current);
        let capacity =
            NonZeroUsize::new(SUBSCRIPTION_CHANNEL_CAPACITY).unwrap_or(NonZeroUsize::MIN);
        let mut subscription = match peer.listen_with_capacity(filter, capacity).await {
            Ok(subscription) => subscription,
            Err(error) => {
                if let Some(current) = server.upgrade() {
                    current.sync.emit(
                        &current.name,
                        McpNotificationKind::SubscriptionEnded,
                        format!("subscription could not start: {error}"),
                    );
                }
                return;
            }
        };
        let mut restart = false;
        loop {
            match subscription.next().await {
                Ok(Some(notification)) => {
                    let Some(current) = server.upgrade() else {
                        let _ = subscription.cancel().await;
                        return;
                    };
                    restart = current.process_notification(notification, &peer).await;
                    if restart {
                        let _ = subscription.cancel().await;
                        break;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    if let Some(current) = server.upgrade() {
                        current.sync.emit(
                            &current.name,
                            McpNotificationKind::SubscriptionEnded,
                            format!("subscription ended: {error}"),
                        );
                    }
                    return;
                }
            }
        }
        if !restart {
            if let Some(current) = server.upgrade() {
                current.sync.emit(
                    &current.name,
                    McpNotificationKind::SubscriptionEnded,
                    "subscription ended",
                );
            }
            return;
        }
    }
}

async fn list_bounded_prompts_peer(peer: &Peer<RoleClient>) -> Result<Vec<rmcp::model::Prompt>> {
    let prompts = peer.list_all_prompts().await?;
    if prompts.len() > MAX_DISCOVERED_PROMPTS {
        bail!("prompt catalog exceeds the {MAX_DISCOVERED_PROMPTS}-entry bound");
    }
    Ok(prompts)
}

pub(super) fn bounded_resource_uris(resources: Vec<rmcp::model::Resource>) -> Vec<String> {
    let mut uris = Vec::new();
    for resource in resources.into_iter().take(MAX_SUBSCRIBED_RESOURCES) {
        if !resource.uri.is_empty() && !uris.contains(&resource.uri) {
            uris.push(resource.uri);
        }
    }
    uris
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt(command_name: &str) -> McpPromptCommand {
        McpPromptCommand {
            command_name: command_name.to_string(),
            server_name: "docs".to_string(),
            prompt_name: command_name.to_string(),
            description: "test prompt".to_string(),
            arguments: Vec::new(),
        }
    }

    #[test]
    fn catalog_replacement_keeps_captured_snapshot_immutable() {
        let state = McpSyncState::new();
        state.initialize(
            HashMap::new(),
            HashMap::from([("old".to_string(), prompt("old"))]),
        );
        let captured = state.snapshot();

        state.initialize(
            HashMap::new(),
            HashMap::from([("new".to_string(), prompt("new"))]),
        );
        let current = state.snapshot();

        assert!(captured.prompt_commands.contains_key("old"));
        assert!(!captured.prompt_commands.contains_key("new"));
        assert!(current.prompt_commands.contains_key("new"));
        assert!(!current.prompt_commands.contains_key("old"));
    }

    #[test]
    fn refresh_failure_observation_retains_last_known_good_snapshot() {
        let state = McpSyncState::new();
        state.initialize(
            HashMap::new(),
            HashMap::from([("stable".to_string(), prompt("stable"))]),
        );
        let before = state.snapshot();
        state.emit(
            "docs",
            McpNotificationKind::CatalogRefreshFailed,
            "tool catalog refresh failed; retaining last-known-good snapshot",
        );
        let after = state.snapshot();
        assert!(Arc::ptr_eq(&before, &after));
        assert!(after.prompt_commands.contains_key("stable"));
    }

    #[test]
    fn dynamic_names_do_not_duplicate_existing_catalog_entries() {
        let mut occupied = HashSet::from(["mcp__docs__search".to_string()]);
        assert_eq!(
            unique_tool_name("docs", "search", &mut occupied),
            "mcp__docs__search__2"
        );
        assert_eq!(occupied.len(), 2);
    }

    #[test]
    fn observations_are_bounded_redacted_and_rate_limited() {
        let state = McpSyncState::new();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        state.set_target(EventSink::channel(sender), Some("worker".to_string()));
        state.set_redactions("docs", vec!["top-secret-value".to_string()]);
        state.emit(
            "docs",
            McpNotificationKind::Log,
            format!("token=top-secret-value {}", "x".repeat(1000)),
        );
        state.emit("docs", McpNotificationKind::Log, "duplicate");
        let event = receiver.try_recv().expect("one observation");
        let AgentEvent::McpNotification { message, .. } = event else {
            panic!("expected MCP notification");
        };
        assert!(!message.contains("top-secret-value"));
        assert!(message.chars().count() <= MAX_OBSERVATION_CHARS);
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn resource_updates_are_deduplicated() {
        let state = McpSyncState::new();
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        state.set_target(EventSink::channel(sender), None);
        state.emit_resource_update("docs", "doc://one");
        state.emit_resource_update("docs", "doc://one");
        assert!(matches!(
            receiver.try_recv(),
            Ok(AgentEvent::McpNotification {
                kind: McpNotificationKind::ResourceUpdated,
                ..
            })
        ));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn resource_subscription_catalog_is_bounded_and_deduplicated() {
        let resources = (0..(MAX_SUBSCRIBED_RESOURCES + 20))
            .map(|index| rmcp::model::Resource::new(format!("doc://{index}"), "doc"))
            .chain(std::iter::once(rmcp::model::Resource::new(
                "doc://0",
                "duplicate",
            )))
            .collect();
        let uris = bounded_resource_uris(resources);
        assert_eq!(uris.len(), MAX_SUBSCRIBED_RESOURCES);
        assert_eq!(uris.iter().filter(|uri| *uri == "doc://0").count(), 1);
    }

    #[tokio::test]
    async fn dropping_notification_task_aborts_processing() {
        struct DropSignal(Option<tokio::sync::oneshot::Sender<()>>);
        impl Drop for DropSignal {
            fn drop(&mut self) {
                if let Some(sender) = self.0.take() {
                    let _ = sender.send(());
                }
            }
        }

        let (sender, receiver) = tokio::sync::oneshot::channel();
        let task = McpNotificationTask::default();
        task.replace(tokio::spawn(async move {
            let _signal = DropSignal(Some(sender));
            std::future::pending::<()>().await;
        }));
        tokio::task::yield_now().await;
        drop(task);
        tokio::time::timeout(Duration::from_secs(1), receiver)
            .await
            .expect("aborted notification task drops its state")
            .expect("drop signal");
    }
}
