//! Keep a known command result and its lease until idempotent settlement succeeds.
use super::*;
use crate::store::{TranscriptAppendError, TranscriptLogWriter};

impl SessionService {
    pub(super) async fn settle_shell_result(
        &self,
        snapshot: ShellCommandSnapshot,
        lease: Arc<sessions::SessionOperationLease>,
    ) -> Result<()> {
        let session_id = self
            .metadata
            .session_id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("missing session id"))?;
        let mut delay = Duration::from_millis(25);
        loop {
            let path = self.metadata.store_path.clone();
            let session_id = session_id.clone();
            let result = snapshot.clone();
            let lease = Arc::clone(&lease);
            let attempt = crate::store::spawn_blocking_store_caller(move || {
                let writer =
                    TranscriptLogWriter::for_run(&path, &session_id, &result.operation_id, &lease)?;
                writer.finish_shell_command(&session_id, &result)
            })
            .await
            .and_then(|result| result);
            match attempt {
                Ok(_) => return Ok(()),
                Err(error) => {
                    if matches!(
                        error.downcast_ref::<TranscriptAppendError>(),
                        Some(
                            TranscriptAppendError::StaleOwner
                                | TranscriptAppendError::StaleRun
                                | TranscriptAppendError::IdentityConflict
                        )
                    ) {
                        return Err(error);
                    }
                    // The task still owns the operation and OS lease. Retry the
                    // same bytes/identity; never execute the command again or
                    // let restart recovery replace this known result.
                    eprintln!("nac: human shell result remains pending: {error:#}");
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_secs(1));
                }
            }
        }
    }
}
