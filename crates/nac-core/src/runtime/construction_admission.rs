//! Selected native construction consumes one delivered original operation.
use super::*;
use std::sync::Arc;

pub(super) struct ConstructionAdmission {
    pub(super) guard: Arc<ManagedRuntimeLeaseGuard>,
    completed: bool,
}
impl ConstructionAdmission {
    pub(super) async fn new(guard: Arc<ManagedRuntimeLeaseGuard>, path: &Path) -> Result<Self> {
        guard.check().await?;
        guard.claim_construction(path)?;
        Ok(Self {
            guard,
            completed: false,
        })
    }
    pub(super) async fn complete(mut self) -> Result<()> {
        self.guard.check().await?;
        self.completed = true;
        Ok(())
    }
    pub(super) async fn complete_for_run(
        mut self,
        path: &Path,
        session_id: String,
        lease: sessions::SessionOperationLease,
    ) -> Result<RuntimeRunAdmission> {
        let admission = RuntimeRunAdmission {
            construction_identity: Arc::new(()),
            guard: Arc::clone(&self.guard),
            session_id,
            operation_lease: Some(lease),
        };
        admission.check_initial(path, &admission.session_id).await?;
        self.completed = true;
        Ok(admission)
    }
}
impl Drop for ConstructionAdmission {
    fn drop(&mut self) {
        // Lost delivery, task cancellation and uncertain construction never
        // expose a second attempt from this original operation.
        if !self.completed {
            self.guard.deny_now();
        }
    }
}

pub(super) async fn check(scope: Option<&Arc<ManagedRuntimeLeaseGuard>>) -> Result<()> {
    if let Some(scope) = scope {
        scope.check().await?;
    }
    Ok(())
}
pub(super) fn pin_client(
    client: ModelClient,
    scope: Option<&Arc<ManagedRuntimeLeaseGuard>>,
) -> ModelClient {
    if scope.is_some() {
        client.with_required_effect_lease()
    } else {
        client
    }
}
pub(super) async fn during<T>(
    scope: Option<&Arc<ManagedRuntimeLeaseGuard>>,
    future: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    check(scope).await?;
    let result = if let Some(scope) = scope {
        tokio::select! {
            biased;
            () = scope.wait_for_denial() => Err(anyhow::anyhow!("runtime construction unavailable")),
            result = future => result,
        }
    } else {
        future.await
    };
    check(scope).await?;
    result
}
pub(super) async fn create_session(
    scope: Option<&Arc<ManagedRuntimeLeaseGuard>>,
    path: &Path,
    snapshot: &SessionSnapshot,
) -> Result<()> {
    if let Some(scope) = scope {
        scope.create_session(snapshot.clone()).await
    } else {
        sessions::create_session(path, snapshot)
    }
}

/// Preserve ordinary MCP semantics; selected construction revalidates before
/// each credential/connection/catalog boundary and races the whole load with
/// the original owner's denial. The registry never acquires renewal authority.
pub(super) async fn load_mcp(
    scope: Option<&Arc<ManagedRuntimeLeaseGuard>>,
    cwd: &Path,
    sandbox: Option<&SandboxSession>,
    paths: &PathContext,
    transport: McpTransportPolicy,
    roots: McpRootPolicy,
) -> Result<crate::mcp::McpLoadOutcome> {
    during(scope, async {
        if let Some(guard) = scope {
            let effect: RuntimeEffectLeaseHandle = Arc::<ManagedRuntimeLeaseGuard>::clone(guard);
            McpRegistry::load_reporting_skips_with_effect_lease(
                cwd, sandbox, paths, transport, roots, effect,
            )
            .await
        } else {
            McpRegistry::load_reporting_skips(cwd, sandbox, paths, transport, roots).await
        }
    })
    .await
}

pub(super) async fn build_agent(
    scope: Option<&Arc<ManagedRuntimeLeaseGuard>>,
    client: ModelClient,
    config: AgentConfig,
) -> Result<Agent> {
    check(scope).await?;
    if let Some(guard) = scope {
        let guard = Arc::clone(guard);
        store::spawn_blocking_store_caller(move || {
            guard.check_now()?;
            let agent = Agent::with_config(client, config)?;
            guard.check_now()?;
            Ok(agent)
        })
        .await
        .context("runtime agent construction task failed")?
    } else {
        Agent::with_config(client, config)
    }
}
