//! Prepare creation responses before the single durable acceptance transaction.
use super::*;
use crate::store::coordinator::PersistenceCommand;

impl SessionService {
    /// Only for a fresh, unpublished runtime. All fallible response loading
    /// happens before insert; the final command reads the actual session list
    /// in the insert transaction so projection failure also rolls back creation.
    pub async fn persist_new_session_with_snapshot(
        &self,
        resources: crate::runtime::PreparedSessionResources,
    ) -> Result<SessionFrontendSnapshot> {
        self.persist_prepared_session(resources, None, None).await
    }

    /// Atomically bind a copied model route to its still-owned source.
    pub async fn persist_new_session_with_model_source(
        &self,
        resources: crate::runtime::PreparedSessionResources,
        source: sessions::ProjectModelSourceRef,
    ) -> Result<SessionFrontendSnapshot> {
        self.persist_prepared_session(resources, None, Some(source))
            .await
    }

    /// Atomically publish the retained launch, session and one initial inbox
    /// item. A cancelled launch cannot cross this acceptance boundary.
    pub async fn persist_new_task_session_with_snapshot(
        &self,
        resources: crate::runtime::PreparedSessionResources,
        launch_id: String,
    ) -> Result<SessionFrontendSnapshot> {
        self.persist_prepared_session(
            resources,
            Some(LaunchPublication::Retained(launch_id)),
            None,
        )
        .await
    }

    pub async fn persist_new_native_task_session_with_snapshot(
        &self,
        resources: crate::runtime::PreparedSessionResources,
        launch_id: String,
    ) -> Result<SessionFrontendSnapshot> {
        self.persist_prepared_session(resources, Some(LaunchPublication::Native(launch_id)), None)
            .await
    }

    async fn persist_prepared_session(
        &self,
        resources: crate::runtime::PreparedSessionResources,
        launch_id: Option<LaunchPublication>,
        model_source: Option<sessions::ProjectModelSourceRef>,
    ) -> Result<SessionFrontendSnapshot> {
        // Accepted blocking work outlives a dropped request. Its shared resource
        // guard must also outlive that request and disarm inside the commit
        // command, before acknowledgement can be lost.
        let resources = Arc::new(StdMutex::new(Some(resources)));
        let operation_resources = Arc::clone(&resources);
        let result = async {
            let snapshot = self.session_snapshot.lock().await.clone().ok_or_else(|| {
                anyhow::anyhow!("fresh session creation requires a session snapshot")
            })?;
            let response = self.frontend_snapshot().await?;
            anyhow::ensure!(
                response.metadata.session_id.as_deref() == Some(snapshot.session_id.as_str()),
                "fresh response omitted its session identity"
            );
            let path = self.metadata.store_path.clone();
            crate::store::spawn_blocking_store_caller(move || {
                let command = CreateSessionWithSnapshot {
                    snapshot,
                    launch_id,
                    model_source,
                    response,
                    resources: operation_resources,
                    #[cfg(test)]
                    after_commit: None,
                };
                if let Some(owner) = crate::store::coordinator::owner_for(&path)? {
                    owner.submit(command)?.acknowledge_blocking()
                } else {
                    command.execute(&path)
                }
            })
            .await?
        }
        .await;
        let rollback = resources
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(rollback) = rollback {
            if let Err(cleanup) = rollback.rollback().await {
                return Err(result
                    .err()
                    .unwrap_or_else(|| anyhow::anyhow!("creation did not retain resources"))
                    .context(format!(
                        "fresh session resource rollback failed: {cleanup:#}"
                    )));
            }
        }
        result
    }
}

enum LaunchPublication {
    Retained(String),
    Native(String),
}

struct CreateSessionWithSnapshot {
    snapshot: sessions::SessionSnapshot,
    launch_id: Option<LaunchPublication>,
    model_source: Option<sessions::ProjectModelSourceRef>,
    response: SessionFrontendSnapshot,
    resources: Arc<StdMutex<Option<crate::runtime::PreparedSessionResources>>>,
    #[cfg(test)]
    after_commit: Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>,
}

impl PersistenceCommand for CreateSessionWithSnapshot {
    type Output = SessionFrontendSnapshot;

    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some(&self.snapshot.session_id))
    }

    fn execute(mut self, path: &Path) -> Result<SessionFrontendSnapshot> {
        let correlation = self.correlation();
        crate::store::retry_busy_correlated(correlation, || {
            let mut connection = crate::store::open_connection(path)?;
            let transaction =
                connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            if let Some(source) = &self.model_source {
                let current = sessions::read_project_session_model_source(
                    &transaction,
                    &source.project_id,
                    &source.session_id,
                )?
                .ok_or_else(|| anyhow::anyhow!("conflict: source session changed or moved"))?;
                let headers: std::collections::BTreeMap<String, String> = current
                    .extra_headers_json
                    .as_deref()
                    .filter(|v| !v.is_empty())
                    .map(serde_json::from_str)
                    .transpose()
                    .map_err(|_| anyhow::anyhow!("conflict: source session changed or moved"))?
                    .unwrap_or_default();
                anyhow::ensure!(
                    self.snapshot.project_id.as_deref() == Some(source.project_id.as_str())
                        && current.config_version == source.config_version
                        && current.backend.as_deref()
                            == Some(self.snapshot.backend.to_string().as_str())
                        && current.base_url == self.snapshot.base_url
                        && current.allow_insecure_http == self.snapshot.allow_insecure_http
                        && current.api_key_env == self.snapshot.api_key_env
                        && headers == self.snapshot.extra_headers,
                    "conflict: source session changed or moved"
                );
            }
            sessions::insert_new_session_in_transaction(&transaction, path, &self.snapshot)?;
            match &self.launch_id {
                Some(LaunchPublication::Native(id)) => {
                    crate::store::native_task_launches::publish_in_transaction(
                        &transaction,
                        id,
                        &self.snapshot,
                    )?;
                }
                Some(LaunchPublication::Retained(id)) => {
                    crate::store::task_launches::publish_in_transaction(
                        &transaction,
                        id,
                        &self.snapshot,
                    )?;
                }
                None => {}
            }
            self.response.sessions = view::list_sessions_with_connection(&transaction)?;
            transaction.commit()?;
            Ok(())
        })?;
        let resources = self
            .resources
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(resources) = resources {
            resources.retain();
        }
        #[cfg(test)]
        if let Some((reached, resume)) = self.after_commit {
            reached.send(())?;
            resume.recv_timeout(Duration::from_secs(5))?;
        }
        Ok(self.response)
    }
}

#[cfg(test)]
#[path = "creation_tests.rs"]
mod tests;
