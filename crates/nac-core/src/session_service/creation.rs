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

struct CreateSessionWithSnapshot {
    snapshot: sessions::SessionSnapshot,
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
            sessions::insert_new_session_in_transaction(&transaction, path, &self.snapshot)?;
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
