//! Per-agent application of durable, session-scoped mount refresh intent.
//! Replacement registries have independent catalog/notification generations.
use super::*;
use std::sync::RwLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SessionMcpRefreshState {
    Current,
    Pending,
    Degraded,
    Failed,
    ScheduledForWorkers,
}

#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionMcpRefreshStatus {
    pub revision: i64,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub requested_at: Option<String>,
    /// Process-local acknowledgement for this direct agent incarnation. An
    /// orchestrator has independent workers and does not claim an aggregate acknowledgement.
    #[cfg_attr(feature = "openapi", schema(required))]
    pub applied_revision: Option<i64>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub incarnation_id: Option<String>,
    pub state: SessionMcpRefreshState,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub message: Option<String>,
}

struct MountState {
    revision: i64,
    applied_revision: Option<i64>,
    registry: Option<Arc<McpRegistry>>,
    state: SessionMcpRefreshState,
    message: Option<String>,
}

pub(crate) struct SessionMcpMounts {
    state: RwLock<MountState>,
    workers: bool,
    incarnation: String,
}

impl SessionMcpMounts {
    pub(crate) fn new(registry: Option<Arc<McpRegistry>>, workers: bool) -> Self {
        Self {
            state: RwLock::new(MountState {
                revision: 0,
                applied_revision: Some(0),
                registry,
                state: SessionMcpRefreshState::Current,
                message: None,
            }),
            workers,
            incarnation: uuid::Uuid::new_v4().to_string(),
        }
    }

    pub(crate) fn registry(&self) -> Option<Arc<McpRegistry>> {
        self.state
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .registry
            .clone()
    }

    pub(crate) fn revision(&self) -> i64 {
        self.state
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .revision
    }

    pub(crate) fn failure(&self) -> Option<String> {
        let state = self
            .state
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.state == SessionMcpRefreshState::Failed)
            .then(|| state.message.clone())
            .flatten()
    }

    pub(crate) fn install(
        &self,
        revision: i64,
        registry: Option<Arc<McpRegistry>>,
        state: SessionMcpRefreshState,
        message: Option<String>,
    ) {
        *self
            .state
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = MountState {
            revision,
            applied_revision: (state != SessionMcpRefreshState::Failed).then_some(revision),
            registry,
            state,
            message,
        };
    }

    pub(crate) fn status(
        &self,
        request: crate::store::SessionMcpRefreshRequest,
    ) -> SessionMcpRefreshStatus {
        let state = self
            .state
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        SessionMcpRefreshStatus {
            revision: request.revision,
            requested_at: request.requested_at,
            applied_revision: (!self.workers).then_some(state.applied_revision).flatten(),
            incarnation_id: (!self.workers).then(|| self.incarnation.clone()),
            state: if self.workers {
                SessionMcpRefreshState::ScheduledForWorkers
            } else if request.revision > state.revision {
                SessionMcpRefreshState::Pending
            } else {
                state.state
            },
            message: if request.revision > state.revision {
                None
            } else {
                state.message.clone()
            },
        }
    }
}

/// A private revision of both configuration and dashboard admission. It never
/// crosses an event/API boundary and contains only digests of sensitive material.
pub(crate) fn mount_source_revision(paths: &PathContext) -> Result<[u8; 32]> {
    let connection = super::admission::ConnectionState::for_home(paths)?;
    let snapshot = || connection.revision();
    let (raw, admission) = match default_config_path(paths) {
        Some(path) if super::file_config::mcp_configuration_state_exists(&path) => {
            super::file_config::read_mcp_configuration_with(&path, |_| snapshot())?
        }
        _ => (String::new(), snapshot()),
    };
    Ok(source_revision(&raw, &admission?))
}

pub(super) fn source_revision(raw: &str, admission: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    digest.update(b"nac-mcp-mount-source-v1\0");
    digest.update(raw.len().to_le_bytes());
    digest.update(raw.as_bytes());
    digest.update(admission);
    digest.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::recording_server::{RecordingMcpServer, TestHome};

    #[tokio::test]
    async fn loaded_snapshot_cannot_be_mistaken_for_restored_configuration() {
        let _env = crate::TEST_ENV_LOCK.lock().unwrap();
        let server = RecordingMcpServer::start();
        let home = TestHome::new("mcp-refresh-restored-source", "recorded", &server.url);
        let path = home.path.join("config.toml");
        let original = std::fs::read(&path).unwrap();
        let paths = PathContext::new(&home.path);
        let before = mount_source_revision(&paths).unwrap();
        let mut changed = String::from_utf8(original.clone()).unwrap();
        changed.push_str("\nallowed_tools = []\n");
        std::fs::write(&path, changed).unwrap();
        let candidate = McpRegistry::load_reporting_skips(
            &home.path,
            None,
            &paths,
            McpTransportPolicy::All,
            McpRootPolicy::Workspace,
        )
        .await
        .unwrap();
        std::fs::write(&path, original).unwrap();
        assert_eq!(mount_source_revision(&paths).unwrap(), before);
        assert_ne!(
            candidate.source_revision,
            Some(before),
            "matching outer reads cannot admit a different loaded configuration"
        );
        assert!(candidate.registry.unwrap().tool_definitions().is_empty());
    }

    async fn load(home: &TestHome) -> Arc<McpRegistry> {
        McpRegistry::load_reporting_skips(
            &home.path,
            None,
            &PathContext::new(&home.path),
            McpTransportPolicy::All,
            McpRootPolicy::Workspace,
        )
        .await
        .unwrap()
        .registry
        .unwrap()
    }

    fn tool(name: &str) -> rmcp::model::Tool {
        serde_json::from_value(serde_json::json!({
            "name": name, "description": "fixture catalog change",
            "inputSchema": {"type": "object", "properties": {}}
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn catalog_commits_and_mount_replacement_keep_independent_generations() {
        let _env = crate::TEST_ENV_LOCK.lock().unwrap();
        let first = RecordingMcpServer::start();
        let second = RecordingMcpServer::start();
        let added = RecordingMcpServer::start();
        let home = TestHome::new("mcp-catalog-versus-mount", "recorded", &first.url);
        let old = load(&home).await;
        let capture = old.capture_tool("mcp__recorded__echo").unwrap();
        let mounts = SessionMcpMounts::new(Some(old.clone()), false);
        // ALL-130 notifications commit into the existing registry. They can
        // change its catalog without a session mount refresh request.
        old.sync
            .replace_tools(&old.servers["recorded"], vec![tool("catalog_only")]);
        assert!(old.capture_tool("mcp__recorded__catalog_only").is_some());
        assert!(old.capture_tool("mcp__recorded__echo").is_none());
        assert_eq!(mounts.revision(), 0);
        std::fs::write(home.path.join("config.toml"), format!(
            "[mcp_servers.recorded]\ntransport = \"streamable_http\"\nurl = {}\napproval = \"allow\"\n\n[mcp_servers.added]\ntransport = \"streamable_http\"\nurl = {}\napproval = \"allow\"\n",
            serde_json::to_string(&second.url).unwrap(), serde_json::to_string(&added.url).unwrap()
        )).unwrap();
        assert!(
            old.capture_tool("mcp__added__echo").is_none(),
            "catalog refresh cannot add a configured server"
        );
        let replacement = load(&home).await;
        mounts.install(
            1,
            Some(replacement.clone()),
            SessionMcpRefreshState::Current,
            None,
        );
        // A delayed notification from a retired mount can touch only its old
        // sync state, even when tool and server names are reused elsewhere.
        old.sync
            .replace_tools(&old.servers["recorded"], vec![tool("late_catalog")]);
        assert!(replacement
            .capture_tool("mcp__recorded__late_catalog")
            .is_none());
        assert!(mounts
            .registry()
            .unwrap()
            .capture_tool("mcp__added__echo")
            .is_some());
        drop(old);
        assert!(!capture.call(serde_json::json!({}), false).await.is_error);
        assert_eq!(first.authorizations("tools/call").len(), 1);
        assert!(second.authorizations("tools/call").is_empty());
        assert!(added.authorizations("tools/call").is_empty());
    }
}
