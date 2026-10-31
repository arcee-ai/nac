//! Agent follow-up admission over the existing inbox/lifecycle owner.
use super::*;
use crate::store::{TaskFollowupError as Error, TaskFollowupReceipt, TaskFollowupRequest};

impl SessionService {
    /// Ordinary agent policy has already authorized the canonical target and
    /// action. This method never issues human intent or changes permissions.
    pub async fn admit_task_followup(
        &self,
        request: TaskFollowupRequest,
    ) -> Result<TaskFollowupReceipt> {
        if self.metadata.session_id.as_deref() != Some(request.target_session_id.as_str()) {
            return Err(Error::Unavailable.into());
        }
        let receipt = self
            .coordinate_local(move |service| -> Result<_> {
                let _active = service.lock_active_operation();
                if let Some(receipt) = crate::store::load_task_followup_receipt(
                    &service.metadata.store_path,
                    &request,
                )? {
                    return Ok(receipt);
                }
                if service
                    .stopping_admission
                    .load(std::sync::atomic::Ordering::Acquire)
                {
                    return Err(Error::Stopping.into());
                }
                crate::store::admit_task_followup(&service.metadata.store_path, &request)
            })
            .await??;
        if !receipt.replayed && receipt.disposition == Some(crate::store::InboxStatus::Pending) {
            // A run owner elsewhere keeps its operation lease. Its steering
            // boundary or settlement will see the same durable item. Idle
            // promotion acquires that lease and selects FIFO exactly once.
            if let Err(error) = self.start_next_direct_inbox_item().await {
                eprintln!(
                    "nac: admitted task follow-up remains pending after wake failure: {error:#}"
                );
            }
        }
        // Disposition is an as-of read: a wake can have delivered it already.
        let path = self.metadata.store_path.clone();
        let caller = receipt.caller_session_id.clone();
        let key = receipt.request_id.clone();
        let replayed = receipt.replayed;
        match crate::store::spawn_blocking_store_caller(move || {
            crate::store::inspect_task_followup_receipt(&path, &caller, &key)
        })
        .await
        {
            Ok(Ok(Some(mut current))) => {
                current.replayed = replayed;
                Ok(current)
            }
            _ => {
                let mut receipt = receipt;
                receipt.disposition = None;
                receipt.delivered_run_id = None;
                Ok(receipt)
            }
        }
    }
}

#[cfg(test)]
#[path = "task_followup_admission_tests.rs"]
mod tests;
