//! Publish only a Core-owned admitted runtime; never create authority from a
//! transport, listed row, UI claim or the ordinary creation/attachment builder.
use super::session_creation::SessionCreationApplication;
use anyhow::{ensure, Result};
use nac_core::session_service::{
    AdmittedSessionPublication, SessionFrontendSnapshot, SessionPublicationKind,
};
use std::sync::Arc;

impl SessionCreationApplication<'_> {
    /// The production Core producer remains uninstalled. Keeping this separate
    /// from ordinary create_session preserves the mediated transport fence.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "actual admitted runtime producer is not installed"
        )
    )]
    pub(crate) async fn publish_admitted_session(
        &self,
        admitted: AdmittedSessionPublication,
    ) -> Result<Option<SessionFrontendSnapshot>> {
        self.start_admitted_session_publication(admitted)?
            .wait()
            .await
    }

    pub(super) async fn publish_admitted_inner(
        &self,
        admitted: &mut AdmittedSessionPublication,
        transfer: Option<&super::create_transfer::CreateTransferOwner>,
    ) -> Result<Option<SessionFrontendSnapshot>> {
        admitted.check_current()?;
        ensure!(
            admitted.store_path() == self.manager.inner.store_path,
            "admitted runtime belongs to another store"
        );
        let retirement = admitted.retirement();
        let id = admitted.session_id().to_owned();
        let gate = self.manager.lifecycle_gate(&id);
        let _lifecycle = tokio::select! {
            biased;
            _ = retirement.retired() => anyhow::bail!("session publication retired"),
            lifecycle = gate.lock() => lifecycle,
        };
        let _host_admission = tokio::select! {
            biased;
            _ = retirement.retired() => anyhow::bail!("session publication retired"),
            admission = self.manager.managed_work_admission_async() => admission?,
        };
        admitted.check_current()?;
        let active = tokio::select! {
            biased;
            _ = retirement.retired() => anyhow::bail!("session publication retired"),
            active = self.manager.inner.active_sessions.read() => active,
        };
        ensure!(
            !active.contains_key(&id),
            "session already has a cached owner"
        );
        drop(active);
        let snapshot = match admitted.kind() {
            // Accepted SQL retains this original owner through its actual
            // acknowledgement. Retirement denies publication; it must not
            // cancel the receiving future and discard the SQL outcome.
            SessionPublicationKind::Create => Some(admitted.persist_creation().await?),
            SessionPublicationKind::Activate => {
                // A cold row may only use a runtime already prepared by the
                // actual admitted Core owner. No attach/recovery/wake here.
                tokio::select! {
                    biased;
                    _ = retirement.retired() => anyhow::bail!("session publication retired"),
                    validation = self.manager.validate_operation_session(
                        &id,
                        super::persistence::OperationSessionScope::Primary,
                    ) => validation?,
                };
                let state = self.manager.session_state();
                let config = tokio::select! {
                    biased;
                    _ = retirement.retired() => anyhow::bail!("session publication retired"),
                    config = state.config_async(&id) => config?,
                };
                ensure!(
                    Some(config.config_version) == admitted.config_version(),
                    "admitted runtime configuration changed"
                );
                None
            }
        };
        #[cfg(test)]
        {
            let gate = self
                .manager
                .inner
                .session_creation_before_projection
                .lock()
                .unwrap()
                .clone();
            if let Some(gate) = gate {
                gate.reached.notify_one();
                tokio::select! {
                    biased;
                    _ = retirement.retired() => anyhow::bail!("session publication retired"),
                    _ = gate.resume.notified() => {},
                }
            }
        }
        let mut active = tokio::select! {
            biased;
            _ = retirement.retired() => anyhow::bail!("session publication retired"),
            active = self.manager.inner.active_sessions.write() => active,
        };
        ensure!(
            !active.contains_key(&id),
            "session already has a cached owner"
        );
        let mut inserted = None;
        let publication = admitted
            .publish(|service| {
                if let Some(owner) = transfer {
                    owner.install_runtime(&service)?;
                }
                inserted = Some(Arc::clone(&service));
                active.insert(id.clone(), service);
                Ok(())
            })
            .and_then(|()| {
                if let Some(owner) = transfer {
                    owner.finish_transfer(admitted)?;
                }
                Ok(())
            });
        if let Err(error) = publication {
            if active
                .get(&id)
                .zip(inserted.as_ref())
                .is_some_and(|(current, inserted)| Arc::ptr_eq(current, inserted))
            {
                active.remove(&id);
            }
            return Err(error);
        }
        Ok(snapshot)
    }
}
