//! Owned validated command DATA retained from the authenticated receiver.
//! No Clone/serde or admission constructor: genuine Core/AFM proof is separate.
use super::{
    public_session_creation::{
        PublicCreateCurrentness, PublicCreationContext, PublicCreationError,
        PublicSessionCreationCommand,
    },
    session_creation::SessionCreationApplication,
};
use crate::{ManagedLocationBinding, SessionManager};
use nac_core::session_service::AdmittedSessionPublication;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// These are verified wire correlations, never verified journal authority.
pub(crate) struct ManagedCreateBinding {
    pub(crate) operation_id: Uuid,
    pub(crate) claim_sequence: i64,
    pub(crate) intended_session_id: Uuid,
    pub(crate) canonical_intent: Value,
    pub(crate) intent_sha256: [u8; 32],
    pub(crate) configuration_sha256: [u8; 32],
}
pub(crate) struct ManagedCreateCurrentness {
    pub(crate) request: PublicCreateCurrentness,
    pub(crate) native: ManagedLocationBinding,
    pub(crate) original_cutoff: Instant,
    pub(crate) original_expiry_epoch_ms: i64,
}
/// Move this same allocation across application/factory/publication boundaries.
/// The binding is private and cannot be replaced by taking only the command.
pub(crate) struct ValidatedManagedCreateRequest {
    command: PublicSessionCreationCommand,
    binding: Box<ManagedCreateBinding>,
    currentness: ManagedCreateCurrentness,
}
impl ValidatedManagedCreateRequest {
    /// Delivery already checked the exact envelope and actual TLS caller.
    /// Constructing data here grants no admission and cannot enable CREATE.
    pub(crate) fn from_checked_envelope(
        command: PublicSessionCreationCommand,
        binding: ManagedCreateBinding,
        currentness: ManagedCreateCurrentness,
    ) -> Self {
        Self {
            command,
            binding: Box::new(binding),
            currentness,
        }
    }
    pub(crate) fn binding(&self) -> &ManagedCreateBinding {
        &self.binding
    }
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "genuine Core command consumer is not installed")
    )]
    pub(crate) fn command(&self) -> &PublicSessionCreationCommand {
        &self.command
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "genuine Core currentness consumer is not installed"
        )
    )]
    pub(crate) fn currentness(&self) -> &ManagedCreateCurrentness {
        &self.currentness
    }

    pub(super) fn check_before_core(
        &self,
        manager: &SessionManager,
    ) -> Result<(), PublicCreationError> {
        self.command.validate()?;
        let b = self.binding();
        let c = &self.currentness;
        if b.operation_id.is_nil()
            || b.claim_sequence <= 0
            || b.intended_session_id.is_nil()
            || c.request.request_id != b.operation_id.to_string()
            || c.request.if_match.is_none()
        {
            return Err(PublicCreationError::InvalidContext);
        }
        let canonical = b
            .canonical_intent
            .as_array()
            .filter(|v| v.len() == 21)
            .ok_or(PublicCreationError::InvalidContext)?;
        if canonical[0] != "native-session-operation-v3"
            || canonical[15] != serde_json::json!(["create"])
        {
            return Err(PublicCreationError::InvalidContext);
        }
        let target = canonical[16]
            .as_array()
            .filter(|v| v.len() == 3)
            .ok_or(PublicCreationError::InvalidContext)?;
        let context_matches = match &self.command.context {
            PublicCreationContext::Project(id) => target[0] == "project" && target[1] == *id,
            PublicCreationContext::WorkingLocation(id) => {
                target[0] == "location" && target[1] == *id
            }
        };
        let bytes = serde_json::to_vec(&b.canonical_intent)
            .map_err(|_| PublicCreationError::InvalidContext)?;
        let observed: [u8; 32] = Sha256::digest(bytes).into();
        let config: [u8; 32] = serde_json::from_value(canonical[19].clone())
            .map_err(|_| PublicCreationError::InvalidContext)?;
        if !context_matches
            || observed != b.intent_sha256
            || config != b.configuration_sha256
            || self
                .command
                .model_config_id
                .as_ref()
                .is_some_and(|id| canonical[17] != *id)
        {
            return Err(PublicCreationError::SourceChanged);
        }
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|v| i64::try_from(v.as_millis()).ok());
        if Instant::now() >= c.original_cutoff
            || !now_ms.is_some_and(|v| v < c.original_expiry_epoch_ms)
            || manager
                .managed_location_binding()
                .map_err(|_| PublicCreationError::SourceChanged)?
                != c.native
        {
            return Err(PublicCreationError::SourceChanged);
        }
        Ok(())
    }

    /// Veto before Core insertion/publication, after the serving registry owns
    /// BOTH this original binding and the actual opaque Core publication.
    pub(super) fn check_prepared(
        &self,
        manager: &SessionManager,
        admitted: &AdmittedSessionPublication,
    ) -> Result<(), PublicCreationError> {
        self.check_before_core(manager)?;
        if admitted.session_id() != self.binding.intended_session_id.to_string() {
            return Err(PublicCreationError::SourceChanged);
        }
        Ok(())
    }
}

/// The closed entry returns the same request intact, even on refusal. It never
/// returns a session or fabricates an operation-bound remote terminal receipt.
pub(crate) struct ManagedCreateRefusal {
    request: ValidatedManagedCreateRequest,
    error: PublicCreationError,
}
impl ManagedCreateRefusal {
    pub(crate) fn error(&self) -> PublicCreationError {
        self.error
    }
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "closed refusal retains original binding until response completion"
        )
    )]
    pub(crate) fn request(&self) -> &ValidatedManagedCreateRequest {
        &self.request
    }
}
impl SessionCreationApplication<'_> {
    pub(crate) fn create_managed_session(
        &self,
        request: ValidatedManagedCreateRequest,
    ) -> ManagedCreateRefusal {
        let error = request
            .check_before_core(self.manager)
            .err()
            .unwrap_or(PublicCreationError::RequiredAuthorityUnavailable);
        ManagedCreateRefusal { request, error }
    }
}
