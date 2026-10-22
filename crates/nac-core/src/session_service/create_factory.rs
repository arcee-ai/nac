//! Retain completed runtime preparation until the private consuming handoff.
//! A failed issuance borrows this allocation; it cannot discard service,
//! preparation resources or original currentness while outcome is unknown.
use super::*;

impl AdmittedSessionPublication {
    /// Veto on an already opaque actual publication before Native starts its
    /// store/publication task. Matching scalar bindings cannot replace the
    /// original Core custody and source allocation. This creates no admission.
    pub fn check_prepared_create_for(
        &self,
        factory: &Arc<crate::runtime::CreateFactoryOwner>,
    ) -> Result<()> {
        self.check_current()?;
        anyhow::ensure!(
            self.kind == SessionPublicationKind::Create
                && !self.persisted
                && !self.publication_consumed,
            "original CREATE preparation already consumed"
        );
        match &self.authority.source {
            PublicationSource::Create(source) => anyhow::ensure!(
                factory.owns_source(source)
                    && self.authority.resources.belongs_to_create_factory(factory),
                "original CREATE factory allocation differs"
            ),
            #[cfg(any(test, feature = "test-support"))]
            PublicationSource::Synthetic => anyhow::bail!("original CREATE source absent"),
        }
        Ok(())
    }
}

pub(crate) struct PreparedCreatePublication {
    parts: Option<PreparedParts>,
}
struct PreparedParts {
    service: SessionService,
    resources: crate::runtime::PreparedSessionResources,
    custody: crate::runtime::CreatePublicationCustody,
}
impl PreparedCreatePublication {
    /// Move original resources into the serving supervisor before any fallible
    /// publication check. This private staging owner does not grant admission.
    pub(crate) fn retain(
        service: SessionService,
        resources: crate::runtime::PreparedSessionResources,
        custody: crate::runtime::CreatePublicationCustody,
    ) -> Self {
        Self {
            parts: Some(PreparedParts {
                service,
                resources,
                custody,
            }),
        }
    }
    async fn validate(
        &self,
    ) -> Result<Arc<crate::store::native_source_reservation::NativeSourceReservation>> {
        let parts = self
            .parts
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("CREATE publication already consumed"))?;
        let service = &parts.service;
        let custody = &parts.custody;
        custody.check_current()?;
        // Ordinary construction leaves this None. The private checked service
        // constructor receives this same context during initial composition;
        // no post-build stamping setter or ordinary builder fallback exists.
        anyhow::ensure!(
            service
                .protected_create_context
                .as_ref()
                .is_some_and(|context| Arc::ptr_eq(context, custody.context())),
            "CREATE service is not owned by the original protected runtime"
        );
        let source = custody.source()?;
        anyhow::ensure!(
            service.metadata.store_path == source.bound_store_path()
                && service.metadata.session_id.as_deref()
                    == Some(source.binding().session_id.as_str())
                && service.metadata.project_id == source.binding().project_id
                && service.config_version.is_some(),
            "CREATE original store/session/configuration binding mismatch"
        );
        {
            let snapshot = service.session_snapshot.lock().await;
            let snapshot = snapshot
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("CREATE snapshot missing"))?;
            anyhow::ensure!(
                crate::store::native_source_reservation::creation_snapshot_sha256(snapshot)?
                    == source.prepared_snapshot_sha256()?,
                "CREATE resolved configuration mismatch"
            );
        }
        // Physical/current source work is outside the later SQLite creation
        // transaction. The actual store command rechecks bounded vetoes there.
        source.check_current()?;
        custody.check_current()?;
        Ok(source)
    }
    pub(crate) async fn try_issue(&mut self) -> Result<AdmittedSessionPublication> {
        let mut attempt = self
            .parts
            .as_ref()
            .map(|parts| parts.custody.publication_attempt());
        let source = self.validate().await?;
        // No fallible checks after moving the original parts. The guard also
        // denies cancellation/panic while this borrowed async attempt is pending.
        let parts = self
            .parts
            .take()
            .ok_or_else(|| anyhow::anyhow!("CREATE publication already consumed"))?;
        let deadline = VerifiedPublicationResources::original_deadline(&parts.custody);
        let source = PublicationSource::Create(source);
        let authority = Arc::new(PublicationAuthority {
            resources: Box::new(parts.custody),
            source,
            deadline,
            retired: AtomicBool::new(false),
            changed: tokio::sync::Notify::new(),
        });
        let publication = AdmittedSessionPublication {
            service: Arc::new(parts.service),
            resources: Some(parts.resources),
            authority,
            kind: SessionPublicationKind::Create,
            persisted: false,
            publication_consumed: false,
            publication_succeeded: false,
            recorded_transfer_issued: false,
        };
        if let Some(guard) = &mut attempt {
            guard.complete();
        }
        Ok(publication)
    }
}
impl Drop for PreparedCreatePublication {
    fn drop(&mut self) {
        if let Some(parts) = &self.parts {
            parts.custody.deny_runtime();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::create_owner_test_helpers::{finish, Fixture};

    #[tokio::test]
    async fn ordinary_service_cannot_issue_and_error_keeps_original_parts() {
        let (parts, _) = crate::session_service::tests::test_active_service(
            "protected-issuer-refuses-ordinary",
            "ordinary-service",
        );
        let fixture = tokio::task::spawn_blocking(Fixture::new).await.unwrap();
        let custody = tokio::task::spawn_blocking(move || {
            let custody = finish(&fixture);
            (fixture, custody)
        })
        .await
        .unwrap();
        let (fixture, custody) = custody;
        let mut prepared = PreparedCreatePublication::retain(
            parts.service,
            crate::runtime::PreparedSessionResources::for_test(None),
            custody,
        );
        assert!(prepared.try_issue().await.is_err());
        assert!(
            prepared.parts.is_some(),
            "discarding issuance error must retain every original prepared allocation"
        );
        fixture.retained_and_denied();
        let original = fixture.observer();
        drop(fixture);
        assert!(
            original.upgrade().is_some(),
            "failed issuance itself retains original runtime/custody"
        );
        drop(prepared);
        assert!(original.upgrade().is_none());
    }

    #[tokio::test]
    async fn copied_context_identity_does_not_bind_original_runtime() {
        let (parts, _) = crate::session_service::tests::test_active_service(
            "protected-issuer-copied-context",
            "copied-context",
        );
        let (fixture, custody) = tokio::task::spawn_blocking(|| {
            let fixture = Fixture::new();
            let custody = finish(&fixture);
            (fixture, custody)
        })
        .await
        .unwrap();
        let mut service = parts.service;
        service.protected_create_context = Some(Arc::new(
            crate::runtime::ProtectedExecutionContext::unqualified(
                Arc::new(crate::sandbox::ExecutionBackend::Local {
                    workspace_cwd: PathBuf::from("/repo"),
                }),
                custody.context().identity(),
            ),
        ));
        let mut prepared = PreparedCreatePublication::retain(
            service,
            crate::runtime::PreparedSessionResources::for_test(None),
            custody,
        );
        assert!(prepared.try_issue().await.is_err());
        assert!(prepared.parts.is_some());
        fixture.retained_and_denied();
    }

    #[tokio::test]
    async fn matching_session_metadata_cannot_replace_resolved_configuration() {
        let (parts, _) = crate::session_service::tests::test_active_service(
            "protected-issuer-config-binding",
            "changed-config",
        );
        let (fixture, custody) = tokio::task::spawn_blocking(|| {
            let fixture = Fixture::new();
            let custody = finish(&fixture);
            (fixture, custody)
        })
        .await
        .unwrap();
        let mut service = parts.service;
        // Private mechanical control reaches the digest check; this is not a
        // protected builder or a production stamping/positive constructor.
        service.protected_create_context = Some(Arc::clone(custody.context()));
        let source = custody.source().unwrap();
        let metadata = Arc::make_mut(&mut service.metadata);
        metadata.store_path = source.bound_store_path().to_owned();
        metadata.session_id = Some(source.binding().session_id.clone());
        metadata.project_id = source.binding().project_id.clone();
        let mut prepared = PreparedCreatePublication::retain(
            service,
            crate::runtime::PreparedSessionResources::for_test(None),
            custody,
        );
        let error = prepared.try_issue().await.err().unwrap();
        assert!(error.to_string().contains("configuration mismatch"));
        assert!(prepared.parts.is_some());
        fixture.retained_and_denied();
    }
    #[tokio::test]
    async fn canceled_borrowed_issue_denies_runtime_and_retains_all_parts() {
        use futures_util::FutureExt;
        let (parts, _) = crate::session_service::tests::test_active_service(
            "protected-issuer-cancellation",
            "canceled-issue",
        );
        let (fixture, custody) = tokio::task::spawn_blocking(|| {
            let fixture = Fixture::new();
            let custody = finish(&fixture);
            (fixture, custody)
        })
        .await
        .unwrap();
        let mut service = parts.service;
        service.protected_create_context = Some(Arc::clone(custody.context()));
        let source = custody.source().unwrap();
        let metadata = Arc::make_mut(&mut service.metadata);
        metadata.store_path = source.bound_store_path().to_owned();
        metadata.session_id = Some(source.binding().session_id.clone());
        metadata.project_id = source.binding().project_id.clone();
        let snapshot = Arc::clone(&service.session_snapshot);
        let snapshot_guard = snapshot.lock().await;
        let mut prepared = PreparedCreatePublication::retain(
            service,
            crate::runtime::PreparedSessionResources::for_test(None),
            custody,
        );
        assert!(prepared.try_issue().now_or_never().is_none());
        assert!(prepared.parts.is_some());
        fixture.retained_and_denied();
        drop(snapshot_guard);
    }
}
