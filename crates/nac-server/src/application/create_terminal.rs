//! Qualified terminal from the original Core publication and Native transfer.
//! No wire request, status or public constructor can create this retained owner.
use super::managed_create_request::ValidatedManagedCreateRequest;
use anyhow::{ensure, Result};
use nac_core::session_service::{RecordedCreatePublication, RecordedCreateTerminal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

pub(crate) const PURPOSE: &str = "managed-session-create-terminal.v2";
pub(crate) const MEDIA_TYPE: &str = "application/vnd.arcee.managed-session-create-terminal.v2+json";
pub(crate) const ACK_PURPOSE: &str = "managed-session-create-ack.v2";

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct AckEnvelope {
    schema: String,
    purpose: String,
    operation: Operation,
    intent: Intent,
    receipt: Receipt,
    terminal_body_sha256: String,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Operation {
    id: String,
    claim_sequence: i64,
    session_id: String,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Intent {
    sha256: String,
    configuration_sha256: String,
}
#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Receipt {
    session_id: String,
    configuration_version: i64,
    configuration_digest: String,
}
impl AckEnvelope {
    pub(crate) fn operation_id(&self) -> &str {
        &self.operation.id
    }
}
fn hex(digest: &[u8; 32]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(64);
    for byte in digest {
        let _ = write!(s, "{byte:02x}");
    }
    s
}

pub(super) struct QualifiedCreateTerminal {
    bytes: Arc<[u8]>,
    if_match: String,
    expected: AckEnvelope,
    core: tokio::sync::Mutex<RecordedCreateTerminal>,
    acknowledgement: Mutex<Option<watch::Receiver<Option<bool>>>>,
}
impl QualifiedCreateTerminal {
    /// Called only inside the actual cache publication/lifecycle boundary.
    /// The recorded Core half remains in the transfer owner on every error.
    pub(super) fn from_published_transfer(
        recorded: &mut Option<RecordedCreatePublication>,
        request: &ValidatedManagedCreateRequest,
        service: &Arc<crate::SessionService>,
    ) -> Result<Arc<Self>> {
        let core = recorded
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("original Core publication half absent"))?;
        core.check_original_history()?;
        ensure!(
            core.is_service(service),
            "Core and Native runtime allocations differ"
        );
        let native = request.binding();
        let binding = core.binding();
        let metadata = service.metadata();
        ensure!(
            binding.operation_id == native.operation_id
                && i64::try_from(binding.claim_sequence).ok() == Some(native.claim_sequence)
                && binding.session_id == native.intended_session_id.to_string()
                && binding.intent_sha256 == native.intent_sha256
                && binding.configuration_sha256 == native.configuration_sha256
                && metadata.session_id.as_deref() == Some(binding.session_id),
            "Core and Native CREATE bindings differ"
        );
        let original_etag = request
            .currentness()
            .request
            .if_match
            .clone()
            .ok_or_else(|| anyhow::anyhow!("original CREATE ETag absent"))?;
        let operation = Operation {
            id: binding.operation_id.to_string(),
            claim_sequence: native.claim_sequence,
            session_id: binding.session_id.to_owned(),
        };
        let intent = Intent {
            sha256: hex(&binding.intent_sha256),
            configuration_sha256: hex(&binding.configuration_sha256),
        };
        let receipt = Receipt {
            session_id: binding.session_id.to_owned(),
            configuration_version: core.config_version(),
            configuration_digest: hex(&binding.configuration_sha256),
        };
        let bytes = serde_json::to_vec(&serde_json::json!({
            "schema":PURPOSE,"purpose":PURPOSE,"operation":operation,"intent":intent,"receipt":receipt,
            "session":{"session_id":binding.session_id,"behavior":metadata.behavior.as_str(),"project_id":metadata.project_id}
        }))?;
        let digest = Sha256::digest(&bytes).into();
        let expected = AckEnvelope {
            schema: ACK_PURPOSE.to_owned(),
            purpose: ACK_PURPOSE.to_owned(),
            operation,
            intent,
            receipt,
            terminal_body_sha256: hex(&digest),
        };
        // Every fallible association/encoding check precedes this resource move.
        let core = recorded
            .take()
            .ok_or_else(|| anyhow::anyhow!("Core half already transferred"))?;
        let core = match core.retain_terminal(digest) {
            Ok(core) => core,
            Err(original) => {
                *recorded = Some(original);
                anyhow::bail!("Core terminal retention refused")
            }
        };
        Ok(Arc::new(Self {
            bytes: bytes.into(),
            if_match: original_etag,
            expected,
            core: tokio::sync::Mutex::new(core),
            acknowledgement: Mutex::new(None),
        }))
    }
    pub(super) fn bytes(&self) -> Arc<[u8]> {
        Arc::clone(&self.bytes)
    }

    pub(super) async fn acknowledge(
        self: &Arc<Self>,
        ack: &AckEnvelope,
        if_match: &str,
        exchange: nac_runtime_auth::CreateAckExchange,
        tasks: &super::publication_tasks::PublicationTasks,
    ) -> Result<()> {
        exchange.check_current()?;
        let cutoff = exchange.original_cutoff();
        let exchange = Arc::new(exchange);
        self.core.lock().await.check_authenticated_ack(&exchange)?;
        ensure!(
            std::time::Instant::now() < cutoff
                && *ack == self.expected
                && if_match == self.if_match,
            "CREATE acknowledgement does not match retained terminal"
        );
        let mut receiver = {
            let mut original = self
                .acknowledgement
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(receiver) = original.as_ref() {
                receiver.clone()
            } else {
                let (sender, receiver) = watch::channel(None);
                let terminal = Arc::clone(self);
                let task_exchange = Arc::clone(&exchange);
                // The SAME serving root stores the actual handle before any
                // waiter can cancel. Accepted SQLite is never cancelled by
                // ACK EOF/expiry; the original exchange lives through its result.
                ensure!(
                    tasks.spawn(async move {
                        let mut core = terminal.core.lock().await;
                        let result = match core.check_authenticated_ack(&task_exchange) {
                            Ok(()) => core.cleanup_after_authenticated_ack().await.is_ok(),
                            Err(_) => false,
                        };
                        sender.send_replace(Some(result));
                    }),
                    "original serving root closed before ACK cleanup"
                );
                *original = Some(receiver.clone());
                receiver
            }
        };
        loop {
            match *receiver.borrow_and_update() {
                Some(true) => {
                    // Cleanup may have committed after transport loss. Keep
                    // that outcome, but never publish 204 on an ended exchange.
                    exchange.check_current()?;
                    return Ok(());
                }
                Some(false) => anyhow::bail!("original CREATE cleanup outcome unknown"),
                None => {}
            }
            match tokio::time::timeout_at(cutoff.into(), receiver.changed()).await {
                Ok(Ok(())) => {}
                _ => anyhow::bail!("original CREATE cleanup remains retained"),
            }
        }
    }
}
