//! Passive product facts. Never attaches/reconstructs a session, connects MCP,
//! resolves credentials, probes a backend or admits work.
mod native;
use crate::SessionManager;
use anyhow::{anyhow, Result};
pub use nac_core::product_context::*;
use nac_core::{mcp_configurations::McpRuntimeState, sessions};

#[derive(Clone)]
pub struct ProductContextApplication {
    manager: SessionManager,
}

impl ProductContextApplication {
    pub fn new(manager: SessionManager) -> Self {
        Self { manager }
    }

    pub async fn read(&self, session_id: Option<&str>) -> Result<ProductContext> {
        let _access = self
            .manager
            .managed_completion_admission_async()
            .await
            .map_err(|_| anyhow!("product context is unavailable"))?;
        let mut destinations = vec![
            destination(ProductDestination::Projects, ProductAvailability::Available),
            destination(
                ProductDestination::McpSettings,
                ProductAvailability::Available,
            ),
            destination(
                ProductDestination::Configurations,
                ProductAvailability::Available,
            ),
            destination(
                ProductDestination::ModelAuthentication,
                ProductAvailability::Available,
            ),
            destination(
                ProductDestination::SshConfigurations,
                ProductAvailability::Available,
            ),
        ];
        let mut features = vec![
            ProductFeature {
                feature: ProductFeatureKind::ManagedHost,
                label: "Managed host".into(),
                availability: if self.manager.managed_host().is_some() {
                    ProductAvailability::Available
                } else {
                    ProductAvailability::Disabled
                },
            },
            ProductFeature {
                feature: ProductFeatureKind::ProductNavigation,
                label: "App navigation".into(),
                availability: ProductAvailability::Available,
            },
        ];
        let session = if let Some(id) = session_id {
            // All observations are scoped to the selected manager/store, with
            // uniform unavailable errors that contain neither caller text nor paths.
            self.manager
                .validate_operation_session(
                    id,
                    super::persistence::OperationSessionScope::Persisted,
                )
                .await
                .map_err(|_| anyhow!("product context is unavailable"))?;
            let manager = self.manager.clone();
            let id_owned = id.to_owned();
            let (summary, lineage) = self
                .manager
                .inner
                ._store_ownership
                .call_legacy(move || {
                    Ok::<_, anyhow::Error>((
                        sessions::load_session_summary(&manager.inner.store_path, &id_owned)?
                            .ok_or_else(|| anyhow!("product context is unavailable"))?,
                        manager.session_lineage(&id_owned)?.is_some(),
                    ))
                })
                .await
                .map_err(|_| anyhow!("product context is unavailable"))?
                .map_err(|_| anyhow!("product context is unavailable"))?;
            let backend = execution_backend(summary.sandboxed, summary.ssh.is_some());
            let direct = summary.behavior != sessions::SessionBehavior::Orchestrator;
            for (feature, label, supported) in [
                (
                    ProductFeatureKind::TraditionalSubagents,
                    "Traditional subagents",
                    direct && !lineage,
                ),
                (
                    ProductFeatureKind::ManagedOrchestrators,
                    "Managed orchestrators",
                    summary.behavior == sessions::SessionBehavior::DirectWithOrchestrator
                        && !lineage,
                ),
            ] {
                features.push(ProductFeature {
                    feature,
                    label: label.into(),
                    availability: if supported {
                        ProductAvailability::Available
                    } else {
                        ProductAvailability::Unavailable
                    },
                });
            }
            let cached = self
                .manager
                .inner
                .active_sessions
                .read()
                .await
                .get(id)
                .cloned();
            let (skills, tools) = cached
                .as_ref()
                .map(|service| service.runtime_capability_counts())
                .unwrap_or((None, None));
            let skills = observed(skills);
            let tools = observed(tools);
            for target in [
                ProductDestination::SessionSubagents,
                ProductDestination::SessionFiles,
                ProductDestination::SessionTerminal,
                ProductDestination::SessionHistory,
            ] {
                let supported = match target {
                    ProductDestination::SessionSubagents => direct && !lineage,
                    ProductDestination::SessionTerminal => {
                        direct
                            && !lineage
                            && backend == ProductExecutionBackend::Local
                            && cached.is_some()
                    }
                    _ => true,
                };
                destinations.push(destination(
                    target,
                    if supported {
                        ProductAvailability::Available
                    } else {
                        ProductAvailability::Unavailable
                    },
                ));
            }
            self.manager
                .validate_operation_session(
                    id,
                    super::persistence::OperationSessionScope::Persisted,
                )
                .await
                .map_err(|_| anyhow!("product context is unavailable"))?;
            Some(ProductSessionContext {
                session_id: id.to_owned(),
                behavior: summary.behavior,
                execution_backend: backend,
                skills,
                tools,
            })
        } else {
            None
        };
        let mcp = match self.manager.mcp_runtime().statuses().await {
            Ok(statuses) => {
                let count = statuses
                    .iter()
                    .filter(|s| s.state == McpRuntimeState::Connected && !s.sessions_blocked)
                    .count();
                let availability = if statuses.is_empty()
                    || statuses
                        .iter()
                        .all(|s| s.state == McpRuntimeState::Disabled)
                {
                    ProductAvailability::Disabled
                } else if count > 0 {
                    ProductAvailability::Available
                } else {
                    ProductAvailability::Unavailable
                };
                ProductCapability {
                    availability,
                    count: Some(count),
                }
            }
            Err(_) => ProductCapability {
                availability: ProductAvailability::Unknown,
                count: None,
            },
        };
        Ok(ProductContext {
            schema_version: 1,
            build: current_build(),
            source: "installed-runtime".into(),
            managed: self.manager.managed_host().is_some(),
            features,
            session,
            mcp,
            destinations,
        })
    }

    /// A headless/native caller receives an applicable logical target and steps.
    /// Browser consumers separately validate their immutable lifetime and visibility.
    pub async fn resolve(
        &self,
        request: ProductNavigationRequest,
    ) -> Result<ProductNavigationResolution> {
        if request.expected_build_id != crate::build_identity::current().build_id {
            return Err(anyhow!(
                "product build changed; inspect product context again"
            ));
        }
        if request.destination.is_session() && request.session_id.is_none() {
            return Err(anyhow!("a current session is required"));
        }
        let context = self.read(request.session_id.as_deref()).await?;
        let target = context
            .destinations
            .into_iter()
            .find(|d| d.destination == request.destination)
            .ok_or_else(|| anyhow!("destination is unavailable"))?;
        Ok(ProductNavigationResolution {
            build: context.build,
            session_id: request.session_id,
            target,
            opened: false,
        })
    }
}

fn execution_backend(sandboxed: bool, ssh: bool) -> ProductExecutionBackend {
    if ssh {
        ProductExecutionBackend::Ssh
    } else if sandboxed {
        ProductExecutionBackend::Podman
    } else {
        ProductExecutionBackend::Local
    }
}
fn observed(count: Option<usize>) -> ProductCapability {
    ProductCapability {
        availability: match count {
            Some(0) => ProductAvailability::Disabled,
            Some(_) => ProductAvailability::Available,
            None => ProductAvailability::Unknown,
        },
        count,
    }
}
fn current_build() -> ProductBuild {
    let build = crate::build_identity::current();
    ProductBuild {
        product_version: build.product_version.into(),
        build_id: build.build_id.into(),
        track: build.track.into(),
        source_revision: build.source_revision.into(),
    }
}
fn destination(
    target: ProductDestination,
    availability: ProductAvailability,
) -> ProductDestinationInfo {
    let steps = match target {
        ProductDestination::Projects => "Open All projects in the sidebar or phone menu.",
        ProductDestination::McpSettings => "Open MCP in the sidebar or phone menu.",
        ProductDestination::Configurations => "Open Configurations in the sidebar or phone menu.",
        ProductDestination::ModelAuthentication => {
            "Open Configurations, choose a provider, then use its authentication controls."
        }
        ProductDestination::SshConfigurations => "Open SSH in the sidebar or phone menu.",
        ProductDestination::SessionSubagents => "Open Subagents in the current chat.",
        ProductDestination::SessionFiles => "Open Files in the current chat.",
        ProductDestination::SessionTerminal => {
            "Open Terminal in the current local direct chat. An attached runtime is required."
        }
        ProductDestination::SessionHistory => {
            "Open History in the current chat on a phone; use the revision selector on desktop."
        }
    };
    let steps = if target == ProductDestination::SessionSubagents
        && availability != ProductAvailability::Available
    {
        "This session does not expose Subagents. Use its supported Insights, Files or Worksets panels."
    } else {
        steps
    };
    ProductDestinationInfo {
        destination: target,
        label: target.label().into(),
        availability,
        steps: steps.into(),
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
