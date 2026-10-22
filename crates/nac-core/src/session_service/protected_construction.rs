//! Existing service composition with actual protected construction retained at
//! creation; no post-construction stamping or public context setter exists.
use super::*;
use crate::runtime::CreatePublicationCustody;

impl SessionService {
    pub(crate) fn from_protected_run_config(
        run_config: OrchestratorRunConfig,
        custody: &CreatePublicationCustody,
    ) -> Result<SessionServiceParts> {
        custody.check_current()?;
        let context = custody.context();
        let source = custody.source()?;
        let OrchestratorSession::Active {
            snapshot,
            store_path,
            session_id,
        } = &run_config.session
        else {
            anyhow::bail!("protected CREATE requires fresh active construction");
        };
        anyhow::ensure!(
            run_config.agent.belongs_to_protected_context(context)
                && run_config.client.belongs_to_protected_context(context)
                && store_path == source.bound_store_path()
                && session_id == &source.binding().session_id
                && snapshot.session_id == *session_id
                && snapshot.project_id == source.binding().project_id
                && crate::store::native_source_reservation::creation_snapshot_sha256(snapshot)?
                    == source.prepared_snapshot_sha256()?,
            "protected CREATE original service construction differs"
        );
        let service = Self::construct_from_run_config(run_config, Some(Arc::clone(context)));
        custody.check_current()?;
        Ok(service)
    }
}
