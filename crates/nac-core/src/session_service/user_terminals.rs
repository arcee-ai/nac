//! Human terminal facade captured outside the agent mutex, so active model
//! execution cannot block observation, typing or geometry changes.

use super::*;
use crate::tools::kernel::{ToolCallContext, ToolRegistry, ToolServices};
use crate::tools::user_terminal::{UserTerminalLaunchTool, OPEN_USER_TERMINAL};

/// Invocation-only human intent, issued after session and launch admission.
/// Fields and construction belong to the lifecycle owner; model/client JSON
/// cannot manufacture this capability or choose another tool to invoke.
pub(crate) struct SubmittedUserTerminal {
    terminal_id: String,
    cols: u16,
    rows: u16,
}

impl SubmittedUserTerminal {
    fn admitted(terminal_id: String, cols: u16, rows: u16) -> Self {
        Self {
            terminal_id,
            cols,
            rows,
        }
    }

    pub(crate) fn tool_input(&self) -> serde_json::Value {
        serde_json::json!({"terminal_id": self.terminal_id, "cols": self.cols, "rows": self.rows})
    }
}

/// Invocation-only trusted human control intent. No wire/model constructor.
pub(crate) struct SubmittedTerminalControl {
    prepared: crate::terminal::PreparedControlChange,
    target: crate::terminal::InputController,
    acknowledge: bool,
}

impl SubmittedTerminalControl {
    pub(crate) fn permission_resources(&self) -> Vec<crate::tools::kernel::PermissionResource> {
        let mut resources = vec![crate::tools::kernel::PermissionResource::new(
            "terminal_control",
            &self.prepared.id,
        )];
        if self.target == crate::terminal::InputController::Human {
            resources.push(crate::tools::kernel::PermissionResource::new(
                "terminal_input",
                &self.prepared.id,
            ));
        }
        resources
    }
}

pub(super) struct UserTerminalContext {
    runtime: crate::tools::ToolRuntime,
    client: crate::model::ModelClient,
    launch_gate: Mutex<()>,
    #[cfg(test)]
    resolved_launch_barrier: Mutex<Option<Arc<tokio::sync::Barrier>>>,
}

impl UserTerminalContext {
    pub(super) fn new(
        runtime: crate::tools::ToolRuntime,
        client: crate::model::ModelClient,
    ) -> Self {
        Self {
            runtime,
            client,
            launch_gate: Mutex::new(()),
            #[cfg(test)]
            resolved_launch_barrier: Mutex::new(None),
        }
    }

    pub(super) async fn stop_admission(&self) {
        self.runtime.command_cancellation.cancel_async().await;
    }
}

impl SessionService {
    #[cfg(test)]
    async fn pause_resolved_user_launch_for_test(&self, barrier: Arc<tokio::sync::Barrier>) {
        *self
            .require_user_terminal_context()
            .unwrap()
            .resolved_launch_barrier
            .lock()
            .await = Some(barrier);
    }

    /// A stable launch id retries the same process-local shell rather than
    /// creating another process when a launch reply or observer disappears.
    /// Once bounded launch history expires, a fresh authorized launch gets a
    /// distinct process id; a stale terminal handle can never address it.
    /// Launch grants ongoing human input; it is never a model capability.
    pub async fn open_user_terminal(
        &self,
        launch_id: Uuid,
        cols: u16,
        rows: u16,
    ) -> Result<UserTerminalStatus> {
        let _host_admission = self.user_terminal_host_admission(false).await?;
        crate::terminal::validate_user_geometry(cols, rows)?;
        self.require_direct_primary_behavior_async().await?;
        let context = self.require_user_terminal_context()?;
        let _launch = context.launch_gate.lock().await;
        let resolved = self
            .terminal_manager
            .resolve_user_terminal_open(launch_id)
            .await;
        #[cfg(test)]
        if let Some(barrier) = context.resolved_launch_barrier.lock().await.take() {
            barrier.wait().await;
            barrier.wait().await;
        }
        let name = match resolved {
            crate::terminal::ResolvedUserTerminalLaunch::Existing(status) => return Ok(status),
            crate::terminal::ResolvedUserTerminalLaunch::Fresh(name) => name,
        };
        let registry = ToolRegistry::builder()
            .register(UserTerminalLaunchTool {
                expected_config_version: self
                    .config_version
                    .ok_or_else(|| anyhow::anyhow!("session configuration authority is missing"))?,
            })
            .finish()?;
        let snapshot = registry.snapshot([OPEN_USER_TERMINAL])?;
        let result = snapshot
            .invoke_submitted_user_terminal(
                &SubmittedUserTerminal::admitted(name.clone(), cols, rows),
                ToolServices {
                    runtime: &context.runtime,
                    client: &context.client,
                },
                &ToolCallContext::default(),
            )
            .await;
        if result.is_error {
            return Err(anyhow::anyhow!(
                "{}",
                result.content.as_text().unwrap_or("terminal launch failed")
            ));
        }
        self.terminal_manager.user_terminal_status(&name).await
    }

    pub async fn list_user_terminals(&self) -> Result<Vec<UserTerminalStatus>> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        if self.user_terminal_context.is_none() {
            return Ok(Vec::new());
        }
        Ok(self.terminal_manager.user_terminal_statuses().await)
    }

    pub async fn user_terminal_status(&self, id: &str) -> Result<UserTerminalStatus> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.terminal_manager.user_terminal_status(id).await
    }

    /// Normalize untrusted rendered text under the exact retained launch policy.
    /// No output cursor, transcript, durable draft or run is changed.
    pub async fn preview_user_terminal_selection(
        &self,
        id: &str,
        text: &str,
    ) -> std::result::Result<UserTerminalSelectionPreview, TerminalSelectionError> {
        self.require_direct_primary_behavior_async()
            .await
            .map_err(|_| TerminalSelectionError::Unavailable)?;
        self.terminal_manager.preview_user_selection(id, text).await
    }

    pub async fn preview_user_terminal_selection_with_text(
        &self,
        id: &str,
        text: &str,
        user_text: Option<&str>,
    ) -> std::result::Result<UserTerminalSelectionPreview, TerminalSelectionError> {
        self.require_direct_primary_behavior_async()
            .await
            .map_err(|_| TerminalSelectionError::Unavailable)?;
        self.terminal_manager
            .preview_user_selection_with_text(id, text, user_text)
            .await
    }

    /// Read only the sanitized artifact bound to this session-owned handle.
    /// Observer cursors are independent and never advance model previews.
    pub async fn read_user_terminal_output(
        &self,
        id: &str,
        offset: u64,
        limit: usize,
    ) -> Result<UserTerminalOutputPage> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.terminal_manager
            .read_user_output(id, offset, limit)
            .await
    }

    /// Bounded observation wake-up, independently of the agent and its input
    /// domain. Collection wakes every observer, including on EOF/error.
    pub async fn wait_for_user_terminal_output(
        &self,
        id: &str,
        observed_end: u64,
        wait_ms: u16,
    ) -> Result<()> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.terminal_manager
            .wait_user_output(id, observed_end, wait_ms)
            .await
    }

    /// Bytes retain their literal meaning; an Enter does not grant or simulate
    /// per-command authorization. The launch authorized this human capability.
    pub async fn write_user_terminal_input(&self, id: &str, bytes: &[u8]) -> Result<()> {
        let _host_admission = self.user_terminal_host_admission(false).await?;
        let context = self.require_user_terminal_context()?;
        self.terminal_manager
            .write_user_input(id, bytes, &context.runtime.command_cancellation)
            .await
    }

    pub async fn terminal_input_control(
        &self,
        id: &str,
    ) -> Result<crate::terminal::InputControlStatus> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.require_user_terminal_context()?;
        self.require_current_input_owner().await?;
        self.terminal_manager.input_control_status(id).await
    }

    /// Explicit trusted human ownership action. It grants no model policy
    /// bypass and never enters the broker or saves a remembered grant.
    pub async fn transfer_terminal_input_control(
        &self,
        id: &str,
        expected: u64,
        target: crate::terminal::InputController,
        acknowledge: bool,
    ) -> Result<crate::terminal::InputControlStatus> {
        let _host_admission = self.user_terminal_host_admission(false).await?;
        self.require_user_terminal_context()?;
        self.require_current_input_owner().await?;
        let submission = SubmittedTerminalControl {
            prepared: self
                .terminal_manager
                .prepare_control_change(id, expected)
                .await?,
            target,
            acknowledge,
        };
        let broker = self
            .permission_broker
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("direct permission broker is unavailable"))?;
        broker.authorize_submitted_terminal_control(&submission)?;
        self.terminal_manager
            .transfer_prepared_input_control(
                &submission.prepared,
                submission.target,
                submission.acknowledge,
            )
            .await
    }

    pub async fn write_controlled_terminal_input(
        &self,
        id: &str,
        expected: u64,
        bytes: &[u8],
    ) -> Result<()> {
        let _host_admission = self.user_terminal_host_admission(false).await?;
        let context = self.require_user_terminal_context()?;
        self.require_current_input_owner().await?;
        self.terminal_manager
            .write_controlled_human_input(
                id,
                expected,
                bytes,
                &context.runtime.command_cancellation,
            )
            .await
    }

    pub async fn write_controlled_terminal_input_receipt(
        &self,
        id: &str,
        expected: u64,
        bytes: &[u8],
    ) -> Result<crate::terminal::InputDeliveryReceipt> {
        let _host_admission = self.user_terminal_host_admission(false).await?;
        let context = self.require_user_terminal_context()?;
        self.require_current_input_owner().await?;
        self.terminal_manager
            .write_controlled_human_input_receipt(
                id,
                expected,
                bytes,
                &context.runtime.command_cancellation,
            )
            .await
    }

    pub async fn resize_user_terminal(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        let context = self.require_user_terminal_context()?;
        self.terminal_manager
            .resize_user_terminal(id, cols, rows, &context.runtime.command_cancellation)
            .await
    }

    pub async fn terminate_user_terminal(&self, id: &str) -> Result<()> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.terminal_manager.terminate_user_terminal(id).await
    }

    pub(super) async fn user_terminal_host_admission(
        &self,
        completion: bool,
    ) -> Result<Option<crate::store::ManagedWorkAdmission>> {
        if !self.managed_admission_enabled {
            return Ok(None);
        }
        let service = self.clone();
        crate::store::call_legacy_store(&self.metadata.store_path, move || {
            match (completion, service.managed_identity.as_deref()) {
                (false, Some(identity)) => crate::store::try_admit_managed_work_for_identity(
                    &service.metadata.store_path,
                    identity,
                ),
                (false, None) => crate::store::try_admit_managed_work(&service.metadata.store_path),
                (true, Some(identity)) => crate::store::try_admit_managed_completion_for_identity(
                    &service.metadata.store_path,
                    identity,
                ),
                (true, None) => {
                    crate::store::try_admit_managed_completion(&service.metadata.store_path)
                }
            }
            .map(Some)
        })
        .await?
    }

    async fn require_current_input_owner(&self) -> Result<()> {
        self.require_direct_primary_behavior_async().await?;
        let service = self.clone();
        crate::store::call_legacy_store(&self.metadata.store_path, move || {
            let id = service
                .metadata
                .session_id
                .as_deref()
                .ok_or_else(|| anyhow::anyhow!("session identity is unavailable"))?;
            let current = sessions::load_session_config(&service.metadata.store_path, id)?;
            anyhow::ensure!(
                Some(current.config_version) == service.config_version,
                "session configuration changed; terminal input owner is unavailable"
            );
            Ok(())
        })
        .await?
    }

    fn require_user_terminal_context(&self) -> Result<&UserTerminalContext> {
        if self
            .stopping_admission
            .load(std::sync::atomic::Ordering::Acquire)
        {
            return Err(anyhow::anyhow!(
                "session is shutting down; terminal mutation is unavailable"
            ));
        }
        self.user_terminal_context
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("human terminals require a direct-primary session"))
    }
}

#[cfg(test)]
#[path = "user_terminals_tests.rs"]
mod tests;
