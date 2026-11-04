use super::*;
use crate::store;
use anyhow::anyhow;

impl SessionService {
    pub async fn mcp_refresh_status(&self) -> Result<crate::mcp::SessionMcpRefreshStatus> {
        let session = self
            .metadata
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("session is not persisted"))?;
        let path = self.metadata.store_path.clone();
        let request = store::call_legacy_store(&path.clone(), move || {
            store::load_session_mcp_refresh(&path, &session)
        })
        .await??;
        Ok(self.mcp.status(request))
    }

    /// Human invocation requests only a mount revision. It grants no tool
    /// authority and never touches the approval broker or active agent lock.
    pub async fn refresh_mcp_integrations(
        &self,
        expected_revision: i64,
    ) -> Result<crate::mcp::SessionMcpRefreshStatus> {
        anyhow::ensure!(
            !self
                .stopping_admission
                .load(std::sync::atomic::Ordering::Acquire),
            "session is stopping"
        );
        let session = self
            .metadata
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("session is not persisted"))?;
        let path = self.metadata.store_path.clone();
        let request = store::call_legacy_store(&path.clone(), move || {
            store::request_session_mcp_refresh(&path, &session, expected_revision)
        })
        .await??;
        Ok(self.mcp.status(request))
    }
}
