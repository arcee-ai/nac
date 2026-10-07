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
use tokio::task::{JoinHandle, JoinSet};
const MAX_SUBSCRIBED_RESOURCES: usize = 256;
const SUBSCRIPTION_CHANNEL_CAPACITY: usize = 64;
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

pub(super) struct McpObservationTarget {
    target: StdRwLock<ObservationTarget>,
}

impl McpObservationTarget {
    pub(super) fn update(&self, sink: EventSink, thread_name: Option<String>) {
        *self
            .target
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            ObservationTarget { sink, thread_name };
    }
}

pub(super) struct McpSyncState {
    pub(super) snapshot: StdRwLock<Arc<McpCatalogSnapshot>>,
    resources: StdRwLock<HashMap<String, Vec<String>>>,
    targets: StdMutex<Vec<Weak<McpObservationTarget>>>,
    redactions: StdRwLock<HashMap<String, Vec<String>>>,
    last_observation: StdMutex<HashMap<(String, McpNotificationKind), Instant>>,
    recent_resource_updates: StdMutex<HashMap<(String, String), Instant>>,
}

#[derive(Default)]
pub(super) struct McpNotificationTask {
    task: StdMutex<Option<JoinHandle<()>>>,
}

impl McpNotificationTask {
    pub(super) fn replace(&self, task: JoinHandle<()>) {
        let previous = self
            .task
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .replace(task);
        if let Some(previous) = previous {
            previous.abort();
        }
    }

    pub(super) fn abort(&self) {
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
            targets: StdMutex::new(Vec::new()),
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

    pub(super) fn register_target(
        &self,
        sink: EventSink,
        thread_name: Option<String>,
    ) -> Arc<McpObservationTarget> {
        let target = Arc::new(McpObservationTarget {
            target: StdRwLock::new(ObservationTarget { sink, thread_name }),
        });
        let mut targets = self
            .targets
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        targets.retain(|target| target.strong_count() > 0);
        targets.push(Arc::downgrade(&target));
        target
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
        let targets = {
            let mut registered = self
                .targets
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let targets: Vec<_> = registered.iter().filter_map(Weak::upgrade).collect();
            registered.retain(|target| target.strong_count() > 0);
            targets
        };
        for target in targets {
            let target = target
                .target
                .read()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            target.sink.emit(AgentEvent::McpNotification {
                thread_name: target.thread_name,
                server_name: server.to_string(),
                kind,
                message: bounded.clone(),
            });
        }
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

pub(super) fn unique_tool_name(
    server: &str,
    remote: &str,
    occupied: &mut HashSet<String>,
) -> String {
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
            connection_generation: 0,
        }
    }

    pub(super) fn with_connection_generation(&self, connection_generation: u64) -> Self {
        Self {
            roots: self.roots.clone(),
            binding: Arc::clone(&self.binding),
            connection_generation,
        }
    }

    pub(super) fn observe_progress(&self, params: ProgressNotificationParam) {
        if let Some(server) = self
            .binding
            .server()
            .filter(|server| server.is_current_connection_generation(self.connection_generation))
        {
            server.observe_progress(params);
        }
    }

    pub(super) fn observe_log(&self, params: LoggingMessageNotificationParam) {
        if let Some(server) = self
            .binding
            .server()
            .filter(|server| server.is_current_connection_generation(self.connection_generation))
        {
            server.observe_log(params);
        }
    }

    pub(super) fn observe_resource_update(&self, params: ResourceUpdatedNotificationParam) {
        if let Some(server) = self
            .binding
            .server()
            .filter(|server| server.is_current_connection_generation(self.connection_generation))
        {
            server.sync.emit_resource_update(&server.name, &params.uri);
        }
    }

    pub(super) async fn refresh_resources(&self, context: NotificationContext<RoleClient>) {
        if let Some(server) = self.binding.server() {
            server
                .refresh_resources(self.connection_generation, &context.peer)
                .await;
        }
    }

    pub(super) async fn refresh_tools(&self, context: NotificationContext<RoleClient>) {
        if let Some(server) = self.binding.server() {
            server
                .refresh_tools(self.connection_generation, &context.peer)
                .await;
        }
    }

    pub(super) async fn refresh_prompts(&self, context: NotificationContext<RoleClient>) {
        if let Some(server) = self.binding.server() {
            server
                .refresh_prompts(self.connection_generation, &context.peer)
                .await;
        }
    }
}

impl McpServer {
    pub(super) async fn reconcile_legacy_subscriptions(
        &self,
        generation: u64,
        peer: &Peer<RoleClient>,
    ) {
        if !self.is_current_connection_generation(generation)
            || !self
                .capabilities
                .resources
                .as_ref()
                .is_some_and(|resources| resources.subscribe == Some(true))
        {
            return;
        }
        let wanted: HashSet<String> = self.sync.resources(&self.name).into_iter().collect();
        let current = {
            let subscriptions = self
                .legacy_subscriptions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if subscriptions.generation != generation {
                return;
            }
            subscriptions.uris.clone()
        };
        for uri in wanted.difference(&current) {
            if !self.is_current_connection_generation(generation) {
                return;
            }
            if matches!(
                self.during_runtime_effect(async {
                    Ok(timeout(
                        self.catalog_timeout,
                        peer.subscribe(SubscribeRequestParams::new(uri.clone())),
                    )
                    .await?)
                })
                .await,
                Ok(Ok(_))
            ) {
                let mut subscriptions = self
                    .legacy_subscriptions
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if subscriptions.generation != generation
                    || !self.is_current_connection_generation(generation)
                {
                    return;
                }
                subscriptions.uris.insert(uri.clone());
            }
        }
        for uri in current.difference(&wanted) {
            if !self.is_current_connection_generation(generation) {
                return;
            }
            let _ = self
                .during_runtime_effect(async {
                    Ok(timeout(
                        self.catalog_timeout,
                        peer.unsubscribe(UnsubscribeRequestParams::new(uri.clone())),
                    )
                    .await?)
                })
                .await;
            let mut subscriptions = self
                .legacy_subscriptions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if subscriptions.generation != generation
                || !self.is_current_connection_generation(generation)
            {
                return;
            }
            subscriptions.uris.remove(uri);
        }
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
        let Ok(service) = self.request_service().await else {
            return;
        };
        let peer = service.peer().clone();
        drop(service);
        let generation = self.current_connection_generation();
        self.reset_legacy_subscriptions(generation);
        let weak = Arc::downgrade(self);
        let task = tokio::spawn(async move {
            let Some(server) = weak.upgrade() else {
                return;
            };
            if server.should_seed_resources() {
                server.refresh_resources(generation, &peer).await;
            }
            if server.protocol_version >= ProtocolVersion::V_2026_07_28 {
                drop(server);
                run_subscription(weak, peer, generation).await;
            }
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

async fn run_subscription(server: Weak<McpServer>, peer: Peer<RoleClient>, generation: u64) {
    let mut refreshes = JoinSet::new();
    let (tool_refresh_sender, mut tool_refresh_receiver) = tokio::sync::mpsc::channel(1);
    let tool_server = Weak::clone(&server);
    let tool_peer = peer.clone();
    refreshes.spawn(async move {
        while tool_refresh_receiver.recv().await.is_some() {
            let Some(current) = tool_server
                .upgrade()
                .filter(|current| current.is_current_connection_generation(generation))
            else {
                return;
            };
            current.refresh_tools(generation, &tool_peer).await;
        }
    });
    let (prompt_refresh_sender, mut prompt_refresh_receiver) = tokio::sync::mpsc::channel(1);
    let prompt_server = Weak::clone(&server);
    let prompt_peer = peer.clone();
    refreshes.spawn(async move {
        while prompt_refresh_receiver.recv().await.is_some() {
            let Some(current) = prompt_server
                .upgrade()
                .filter(|current| current.is_current_connection_generation(generation))
            else {
                return;
            };
            current.refresh_prompts(generation, &prompt_peer).await;
        }
    });
    loop {
        let Some(current) = server.upgrade() else {
            return;
        };
        if !current.is_current_connection_generation(generation) {
            return;
        }
        let filter = current.subscription_filter();
        let capacity =
            NonZeroUsize::new(SUBSCRIPTION_CHANNEL_CAPACITY).unwrap_or(NonZeroUsize::MIN);
        let subscription = current
            .during_runtime_effect(async {
                peer.listen_with_capacity(filter, capacity)
                    .await
                    .map_err(Into::into)
            })
            .await;
        drop(current);
        let mut subscription = match subscription {
            Ok(subscription) => subscription,
            Err(error) => {
                if let Some(current) = server
                    .upgrade()
                    .filter(|current| current.is_current_connection_generation(generation))
                {
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
                    if !current.is_current_connection_generation(generation) {
                        let _ = subscription.cancel().await;
                        return;
                    }
                    match notification {
                        ServerNotification::ToolListChangedNotification(_) => {
                            let _ = tool_refresh_sender.try_send(());
                        }
                        ServerNotification::PromptListChangedNotification(_) => {
                            let _ = prompt_refresh_sender.try_send(());
                        }
                        ServerNotification::ResourceListChangedNotification(_) => {
                            let _ = subscription.cancel().await;
                            current.refresh_resources(generation, &peer).await;
                            restart = true;
                            break;
                        }
                        ServerNotification::ResourceUpdatedNotification(notification) => current
                            .sync
                            .emit_resource_update(&current.name, &notification.params.uri),
                        ServerNotification::ProgressNotification(notification) => {
                            current.observe_progress(notification.params);
                        }
                        ServerNotification::LoggingMessageNotification(notification) => {
                            current.observe_log(notification.params);
                        }
                        _ => {}
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    if let Some(current) = server
                        .upgrade()
                        .filter(|current| current.is_current_connection_generation(generation))
                    {
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
            if let Some(current) = server
                .upgrade()
                .filter(|current| current.is_current_connection_generation(generation))
            {
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
        let _target = state.register_target(EventSink::channel(sender), Some("worker".to_string()));
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
        let _target = state.register_target(EventSink::channel(sender), None);
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
    fn observations_reach_each_registered_agent() {
        let state = McpSyncState::new();
        let (first_sender, mut first_receiver) = tokio::sync::mpsc::unbounded_channel();
        let (second_sender, mut second_receiver) = tokio::sync::mpsc::unbounded_channel();
        let _first =
            state.register_target(EventSink::channel(first_sender), Some("first".to_string()));
        let _second = state.register_target(
            EventSink::channel(second_sender),
            Some("second".to_string()),
        );

        state.emit("docs", McpNotificationKind::Log, "shared observation");

        for (receiver, expected) in [
            (&mut first_receiver, "first"),
            (&mut second_receiver, "second"),
        ] {
            assert!(matches!(
                receiver.try_recv(),
                Ok(AgentEvent::McpNotification {
                    thread_name: Some(thread_name),
                    message,
                    ..
                }) if thread_name == expected && message == "shared observation"
            ));
        }
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

    #[tokio::test]
    async fn dropping_notification_task_aborts_tracked_refreshes() {
        struct DropSignal(Option<tokio::sync::oneshot::Sender<()>>);
        impl Drop for DropSignal {
            fn drop(&mut self) {
                if let Some(sender) = self.0.take() {
                    let _ = sender.send(());
                }
            }
        }

        let (started_sender, started_receiver) = tokio::sync::oneshot::channel();
        let (dropped_sender, dropped_receiver) = tokio::sync::oneshot::channel();
        let task = McpNotificationTask::default();
        task.replace(tokio::spawn(async move {
            let mut refreshes = JoinSet::new();
            refreshes.spawn(async move {
                let _signal = DropSignal(Some(dropped_sender));
                let _ = started_sender.send(());
                std::future::pending::<()>().await;
            });
            std::future::pending::<()>().await;
        }));
        started_receiver.await.expect("refresh started");

        drop(task);

        tokio::time::timeout(Duration::from_secs(1), dropped_receiver)
            .await
            .expect("aborted listener drops its refresh set")
            .expect("refresh drop signal");
    }
}
