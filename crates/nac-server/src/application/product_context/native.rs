//! Construction-bound native port. No process-global lookup can transfer an old
//! runtime to a replacement manager serving the same path or session ID.
use super::ProductContextApplication;
use crate::{SessionManager, SessionManagerInner};
use anyhow::{anyhow, Result};
use nac_core::product_context::ProductContextFuture;
use nac_core::product_context::{
    ProductContext, ProductContextPort, ProductDestination, ProductNavigationRequest,
    ProductNavigationResolution,
};
use std::sync::{Arc, Weak};

struct BoundProductContext {
    manager: Weak<SessionManagerInner>,
    session: String,
}
impl BoundProductContext {
    fn application(&self) -> Result<ProductContextApplication> {
        let inner = self
            .manager
            .upgrade()
            .ok_or_else(|| anyhow!("product owner is closed"))?;
        if inner.task_preparations.is_stopping() {
            return Err(anyhow!("product owner is closed"));
        }
        Ok(ProductContextApplication::new(SessionManager { inner }))
    }
}
impl ProductContextPort for BoundProductContext {
    fn read(&self) -> ProductContextFuture<'_, ProductContext> {
        Box::pin(async move { self.application()?.read(Some(&self.session)).await })
    }
    fn resolve(
        &self,
        destination: ProductDestination,
        expected_build_id: String,
    ) -> ProductContextFuture<'_, ProductNavigationResolution> {
        Box::pin(async move {
            self.application()?
                .resolve(ProductNavigationRequest {
                    destination,
                    expected_build_id,
                    session_id: Some(self.session.clone()),
                })
                .await
        })
    }
}
impl SessionManager {
    pub(crate) fn bind_product_context(
        &self,
        config: &mut nac_core::runtime::OrchestratorRunConfig,
    ) -> Result<()> {
        config.bind_product_context(|session| {
            Arc::new(BoundProductContext {
                manager: Arc::downgrade(&self.inner),
                session: session.to_owned(),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{seed_direct_session, test_manager};

    #[tokio::test]
    async fn a_native_port_never_follows_a_replacement_owner_at_the_same_store() {
        let root = std::env::temp_dir().join(format!("nac-context-owner-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let _env = crate::tests::ScopedModelEnv::isolated(&root.join("nac-home"), None);
        seed_direct_session(&root, "same-id");
        let old = test_manager(&root);
        let port = BoundProductContext {
            manager: Arc::downgrade(&old.inner),
            session: "same-id".into(),
        };
        assert!(port.read().await.is_ok());
        drop(old);
        let replacement = test_manager(&root);
        assert!(port.read().await.is_err());
        assert!(port
            .resolve(
                ProductDestination::McpSettings,
                crate::build_identity::current().build_id.into()
            )
            .await
            .is_err());
        let fresh = BoundProductContext {
            manager: Arc::downgrade(&replacement.inner),
            session: "same-id".into(),
        };
        assert!(fresh.read().await.is_ok());
        replacement.inner.task_preparations.stop();
        assert!(fresh.read().await.is_err());
        drop(replacement);
        std::fs::remove_dir_all(root).unwrap();
    }
}
