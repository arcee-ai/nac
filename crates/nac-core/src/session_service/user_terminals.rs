//! Human terminal facade captured outside the agent mutex, so active model
//! execution cannot block observation, typing or geometry changes.

use super::*;
use crate::tools::kernel::{ToolCallContext, ToolRegistry, ToolServices};
use crate::tools::user_terminal::{UserTerminalLaunchTool, OPEN_USER_TERMINAL};

pub(super) struct UserTerminalContext {
    runtime: crate::tools::ToolRuntime,
    client: crate::model::ModelClient,
    launch_gate: Mutex<()>,
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
        }
    }

    pub(super) async fn stop_admission(&self) {
        self.runtime.command_cancellation.cancel_async().await;
    }
}

impl SessionService {
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
        crate::terminal::validate_user_geometry(cols, rows)?;
        self.require_direct_primary_behavior_async().await?;
        let context = self.require_user_terminal_context()?;
        let _launch = context.launch_gate.lock().await;
        let name = self
            .terminal_manager
            .resolve_user_terminal_launch(launch_id)
            .await;
        if let Ok(status) = self.terminal_manager.user_terminal_status(&name).await {
            return Ok(status);
        }
        let registry = ToolRegistry::builder()
            .register(UserTerminalLaunchTool {
                expected_config_version: self
                    .config_version
                    .ok_or_else(|| anyhow::anyhow!("session configuration authority is missing"))?,
            })
            .finish()?;
        let snapshot = registry.snapshot([OPEN_USER_TERMINAL])?;
        let result = snapshot
            .invoke(
                OPEN_USER_TERMINAL,
                serde_json::json!({"terminal_id": name, "cols": cols, "rows": rows}),
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
        if self.user_terminal_context.is_none() {
            return Ok(Vec::new());
        }
        let mut names = self.terminal_manager.user_terminal_names().await;
        names.sort();
        let mut statuses = Vec::with_capacity(names.len());
        for name in names {
            statuses.push(self.terminal_manager.user_terminal_status(&name).await?);
        }
        Ok(statuses)
    }

    pub async fn user_terminal_status(&self, id: &str) -> Result<UserTerminalStatus> {
        self.terminal_manager.user_terminal_status(id).await
    }

    /// Read only the sanitized artifact bound to this session-owned handle.
    /// Observer cursors are independent and never advance model previews.
    pub async fn read_user_terminal_output(
        &self,
        id: &str,
        offset: u64,
        limit: usize,
    ) -> Result<UserTerminalOutputPage> {
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
        self.terminal_manager
            .wait_user_output(id, observed_end, wait_ms)
            .await
    }

    /// Bytes retain their literal meaning; an Enter does not grant or simulate
    /// per-command authorization. The launch authorized this human capability.
    pub async fn write_user_terminal_input(&self, id: &str, bytes: &[u8]) -> Result<()> {
        let context = self.require_user_terminal_context()?;
        self.terminal_manager
            .write_user_input(id, bytes, &context.runtime.command_cancellation)
            .await
    }

    pub async fn resize_user_terminal(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let context = self.require_user_terminal_context()?;
        self.terminal_manager
            .resize_user_terminal(id, cols, rows, &context.runtime.command_cancellation)
            .await
    }

    pub async fn terminate_user_terminal(&self, id: &str) -> Result<()> {
        self.terminal_manager.terminate_user_terminal(id).await
    }

    fn require_user_terminal_context(&self) -> Result<&UserTerminalContext> {
        if self.managed_admission_enabled {
            return Err(anyhow::anyhow!(
                "human terminals on managed hosts require managed terminal admission support"
            ));
        }
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
