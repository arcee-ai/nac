//! Existing process observation outside the model and durable recovery owners.
use super::*;

impl SessionService {
    pub async fn execution_catalog(&self) -> Result<Vec<ExecutionStatus>> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.require_direct_primary_behavior_async().await?;
        Ok(self.terminal_manager.execution_catalog().await)
    }

    pub async fn execution_status(&self, id: &str) -> Result<ExecutionStatus> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.require_direct_primary_behavior_async().await?;
        self.terminal_manager.execution_status(id).await
    }

    pub async fn read_execution_output(
        &self,
        id: &str,
        offset: u64,
        limit: usize,
    ) -> Result<UserTerminalOutputPage> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.require_direct_primary_behavior_async().await?;
        self.terminal_manager
            .read_execution_output(id, offset, limit)
            .await
    }

    pub async fn wait_for_execution_output(
        &self,
        id: &str,
        observed_end: u64,
        wait_ms: u16,
    ) -> Result<()> {
        anyhow::ensure!(wait_ms <= 1000, "execution wait exceeds bound");
        let deadline =
            std::time::Instant::now() + std::time::Duration::from_millis(u64::from(wait_ms));
        loop {
            let status = self.execution_status(id).await?;
            let page = self.read_execution_output(id, observed_end, 1).await?;
            if page.gap
                || !page.bytes.is_empty()
                || status.output_complete
                || std::time::Instant::now() >= deadline
            {
                return Ok(());
            }
            tokio::time::sleep(
                std::time::Duration::from_millis(20)
                    .min(deadline.saturating_duration_since(std::time::Instant::now())),
            )
            .await;
        }
    }

    pub async fn stop_execution(&self, id: &str) -> Result<()> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.require_direct_primary_behavior_async().await?;
        self.terminal_manager.stop_execution(id).await
    }
}
