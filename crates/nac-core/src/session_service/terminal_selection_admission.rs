//! Identified literal evidence admission, reusing direct inbox delivery.
use super::*;

#[cfg(test)]
#[path = "terminal_selection_admission_tests.rs"]
mod tests;
use crate::store::{
    TerminalSelectionAdmissionError as Error, TerminalSelectionDelivery as Delivery,
    TerminalSelectionIntent, TerminalSelectionReceipt,
};

impl SessionService {
    /// Called only after the application has revalidated the source and canonical
    /// preview. The durable transaction, not local locks, deduplicates identity.
    pub async fn admit_terminal_selection_intent(
        &self,
        intent: TerminalSelectionIntent,
    ) -> Result<TerminalSelectionReceipt> {
        self.require_direct_primary_behavior_async().await?;
        if self.metadata.session_id.as_deref() != Some(&intent.source_session_id) {
            return Err(Error::Unavailable.into());
        }
        let (receipt, idle_lease) = self.coordinate_local(move |service| -> Result<_> {
            let active = service.lock_active_operation();
            // Reconciliation does not acquire a run lease, wake or check an
            // expired source. A concurrent creator may already have committed.
            if let Some(receipt) = crate::store::load_terminal_selection_receipt(&service.metadata.store_path, &intent)? {
                return Ok((receipt, None));
            }
            if service.stopping_admission.load(std::sync::atomic::Ordering::Acquire) {
                return Err(Error::Stopping.into());
            }
            let idle_lease = match intent.initial_delivery {
                Delivery::Send => {
                    if active.is_some() { return Err(Error::DeliveryConflict.into()); }
                    Some(sessions::SessionOperationLease::try_acquire(&service.metadata.store_path, &intent.source_session_id)
                        .map_err(|error| match error { sessions::SessionOperationLeaseError::Busy(_) => anyhow::Error::from(Error::DeliveryConflict), sessions::SessionOperationLeaseError::Store(error) => error })?)
                }
                Delivery::Steer => {
                    if !matches!(active.as_ref(), Some(ActiveSessionOperation::Run(run)) if !run.finishing && Some(run.snapshot.run_id.as_str()) == intent.initial_expected_run_id.as_deref()) {
                        return Err(Error::DeliveryConflict.into());
                    }
                    None
                }
                Delivery::Queue => None,
            };
            let receipt = crate::store::create_terminal_selection_intent(&service.metadata.store_path, &intent)?;
            Ok((receipt, idle_lease))
        }).await??;
        if !receipt.replayed {
            // A start failure follows an accepted durable intent. Keep the
            // pending receipt truthful; never turn it into a second admission.
            let wake = if let Some(lease) = idle_lease {
                self.start_next_direct_inbox_item_with_lease_async(lease)
                    .await
            } else if receipt.intent.initial_delivery != Delivery::Steer {
                self.start_next_direct_inbox_item().await
            } else {
                Ok(None)
            };
            if wake.is_err() {
                eprintln!("nac: accepted terminal selection remains pending after wake failure");
            }
        }
        Ok(receipt)
    }
}
