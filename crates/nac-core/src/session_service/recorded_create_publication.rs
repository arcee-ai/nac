//! Original Core publication half retained by Native's separate terminal owner.
//! This half does not qualify Native cache, lifecycle, isolation or completion.
use super::*;
use crate::runtime::{CreateFactoryOwner, NativeCreateBinding};

/// One-use Core handoff from the actual publication, never receipt rehydration.
/// Retains the original service, authority and factory after CREATE retirement.
/// Native must retain it before further fallible checks, and associate THIS same
/// allocation with its private qualified terminal only after actual cache,
/// lifecycle and resource transfer checks. Neither this half nor its DATA
/// projection authorizes execution or retires preparation resources.
///
/// ```compile_fail
/// let _ = nac_core::session_service::RecordedCreatePublication {};
/// ```
/// ```compile_fail
/// fn cloneable<T: Clone>() {}
/// cloneable::<nac_core::session_service::RecordedCreatePublication>();
/// ```
/// ```compile_fail
/// fn debug<T: std::fmt::Debug>() {}
/// debug::<nac_core::session_service::RecordedCreatePublication>();
/// ```
/// ```compile_fail
/// fn serialize(value: &nac_core::session_service::RecordedCreatePublication) {
///     let _ = serde_json::to_vec(value);
/// }
/// ```
pub struct RecordedCreatePublication {
    authority: Arc<PublicationAuthority>,
    service: Arc<SessionService>,
    factory: Arc<CreateFactoryOwner>,
    configuration_version: i64,
}
impl AdmittedSessionPublication {
    /// Issue this actual Core half once while the original publication is still
    /// current, inside Native's original task before one-use retirement.
    /// Failure borrows and retains the original publication. No callback,
    /// caller-provided status, receipt or serialized owner can issue this half.
    pub fn take_recorded_create_for(
        &mut self,
        factory: &Arc<CreateFactoryOwner>,
    ) -> Result<RecordedCreatePublication> {
        anyhow::ensure!(
            !self.recorded_transfer_issued,
            "Core publication half already issued"
        );
        self.check_published_create_for(factory)?;
        let version = self
            .service
            .config_version
            .filter(|version| *version >= 0)
            .ok_or_else(|| anyhow::anyhow!("CREATE publication configuration unavailable"))?;
        let recorded = RecordedCreatePublication {
            authority: Arc::clone(&self.authority),
            service: Arc::clone(&self.service),
            factory: Arc::clone(factory),
            configuration_version: version,
        };
        self.recorded_transfer_issued = true;
        Ok(recorded)
    }
}
impl RecordedCreatePublication {
    /// Bounded original-process/source/factory association only. Old CREATE
    /// expiry/retirement is expected for later authenticated ACK cleanup and is
    /// never revived here. Fresh ACK and Native terminal checks remain required.
    pub fn check_original_history(&self) -> Result<()> {
        match &self.authority.source {
            PublicationSource::Create(source) => anyhow::ensure!(
                self.factory.owns_source(source)
                    && self
                        .authority
                        .resources
                        .belongs_to_create_factory(&self.factory)
                    && self.service.metadata.store_path == source.bound_store_path()
                    && self.service.metadata.session_id.as_deref()
                        == Some(source.binding().session_id.as_str())
                    && self.service.metadata.project_id == source.binding().project_id
                    && self.service.config_version == Some(self.configuration_version),
                "original Core publication history differs"
            ),
            #[cfg(any(test, feature = "test-support"))]
            PublicationSource::Synthetic => {
                anyhow::bail!("original Core publication source unavailable")
            }
        }
        Ok(())
    }
    /// Association DATA for comparison against Native's actual cached Arc.
    pub fn is_service(&self, service: &Arc<SessionService>) -> bool {
        Arc::ptr_eq(&self.service, service)
    }
    pub fn binding(&self) -> NativeCreateBinding<'_> {
        self.factory.binding()
    }
    pub fn config_version(&self) -> i64 {
        self.configuration_version
    }
}

/// Original Core publication retained with Native's exact terminal bytes.
/// This owner neither authenticates wire ACKs nor grants runtime authority.
/// Native must compare the fresh authenticated ACK against its same retained
/// terminal and call cleanup only after that match. Failed or dropped waiters
/// retain this allocation and never imply cleanup or release active runtime.
pub struct RecordedCreateTerminal {
    publication: RecordedCreatePublication,
    body_sha256: [u8; 32],
}
impl RecordedCreatePublication {
    pub fn retain_terminal(self, body_sha256: [u8; 32]) -> Result<RecordedCreateTerminal, Self> {
        if body_sha256 == [0; 32] || self.check_original_history().is_err() {
            return Err(self);
        }
        Ok(RecordedCreateTerminal {
            publication: self,
            body_sha256,
        })
    }
}
impl RecordedCreateTerminal {
    /// Veto against the original participant and a distinct actual enrolled
    /// ACK connection. This cannot revive CREATE or grant runtime effects.
    pub fn check_authenticated_ack(&self, ack: &nac_runtime_auth::CreateAckExchange) -> Result<()> {
        self.publication.check_original_history()?;
        self.publication.factory.check_ack_exchange(ack)
    }

    /// Invoke only from Native's same retained terminal after its fresh pinned
    /// ACK validation. Borrows the original owner; errors retain it. The store
    /// command lives through its real commit acknowledgement independently of
    /// a dropped caller. No runtime lifetime/capacity/backend owner is retired.
    pub async fn cleanup_after_authenticated_ack(&mut self) -> Result<()> {
        self.publication.check_original_history()?;
        let source = match &self.publication.authority.source {
            PublicationSource::Create(source) => Arc::clone(source),
            #[cfg(any(test, feature = "test-support"))]
            PublicationSource::Synthetic => anyhow::bail!("CREATE original source unavailable"),
        };
        let terminal = self.body_sha256;
        let version = self.publication.configuration_version;
        crate::store::spawn_blocking_store_caller(move || {
            crate::store::native_create_cleanup::complete(source, terminal, version)
        })
        .await??;
        Ok(())
    }
}
