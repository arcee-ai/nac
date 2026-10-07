//! The connection retains the original that admitted its construction.
use super::*;
use crate::runtime::RuntimeEffectLeaseHandle;

impl McpServer {
    pub(super) fn runtime_effect_available(&self) -> bool {
        self.runtime_effect
            .as_ref()
            .is_none_or(|effect| effect.check_available().is_ok())
    }

    pub(super) async fn check_runtime_effect(&self) -> Result<()> {
        if let Some(effect) = &self.runtime_effect {
            effect.check_current().await?;
            effect.check_available()?;
        }
        Ok(())
    }

    pub(super) async fn during_runtime_effect<T>(
        &self,
        future: impl std::future::Future<Output = Result<T>>,
    ) -> Result<T> {
        self.check_runtime_effect().await?;
        let result = if let Some(effect) = &self.runtime_effect {
            tokio::select! {
                biased;
                () = effect.wait_for_denial() => bail!("MCP original runtime operation unavailable"),
                result = future => result,
            }
        } else {
            future.await
        };
        self.check_runtime_effect().await?;
        result
    }

    /// Wait for both connection locks before the last check at the SDK boundary.
    pub(super) async fn request_service(
        &self,
    ) -> Result<tokio::sync::OwnedRwLockReadGuard<McpService>> {
        self.during_runtime_effect(async {
            let service = self.current_service().await;
            let service = service.read_owned().await;
            self.check_runtime_effect().await?;
            Ok(service)
        })
        .await
    }

    pub(super) async fn start_runtime_effect_watch(self: &Arc<Self>) -> Result<()> {
        let Some(effect) = self.runtime_effect.as_ref().map(Arc::clone) else {
            return Ok(());
        };
        let cancellation = self.request_service().await?.cancellation_token();
        self.retain_runtime_cancellation(cancellation)?;
        let weak = Arc::downgrade(self);
        self.runtime_effect_task.replace(tokio::spawn(async move {
            effect.wait_for_denial().await;
            // Cancellation is independent of the connection locks: a queued
            // writer must not keep a remote RPC or transport alive on expiry.
            if let Some(server) = weak.upgrade() {
                let cancellation = server
                    .runtime_effect_cancellation
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .take();
                if let Some(cancellation) = cancellation {
                    cancellation.cancel();
                }
                server.notification_task.abort();
                let service = server.current_service().await;
                close_shared_mcp_service(service).await;
            }
        }));
        Ok(())
    }

    pub(super) fn retain_runtime_cancellation(
        &self,
        cancellation: rmcp::service::RunningServiceCancellationToken,
    ) -> Result<()> {
        if self.runtime_effect.is_none() {
            return Ok(());
        }
        let mut selected = self
            .runtime_effect_cancellation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !self.runtime_effect_available() {
            cancellation.cancel();
            bail!("MCP original runtime operation unavailable");
        }
        *selected = Some(cancellation);
        Ok(())
    }
}

impl McpRegistry {
    pub(crate) fn matches_runtime_effect(&self, effect: &RuntimeEffectLeaseHandle) -> bool {
        !self.servers.is_empty()
            && self.servers.values().all(|server| {
                server
                    .runtime_effect
                    .as_ref()
                    .is_some_and(|captured| Arc::ptr_eq(captured, effect))
            })
    }
}
