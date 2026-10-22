//! Restricted public CREATE data mapping. Source observations grant no effects.
use super::{
    prepared_location_custody::PreparedLocationCustody,
    session_creation::{
        apply_project_model_defaults, SessionCreationApplication, SessionCreationCommand,
    },
    Field,
};
use crate::{ManagedLocationFact, ManagedLocationSelector, SessionManager};
use nac_core::{
    model_configurations::{self, ModelConfigurationRecord},
    projects,
    sessions::SessionBehavior,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PublicCreationContext {
    Project(String),
    WorkingLocation(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublicSessionCreationCommand {
    pub(crate) context: PublicCreationContext,
    pub(crate) model_config_id: Option<String>,
    pub(crate) reasoning_effort: Field<String>,
    pub(crate) behavior: SessionBehavior,
    pub(crate) first_chat: bool,
    pub(crate) first_chat_same_behavior: bool,
}

/// Correlation/precondition DATA, not principal or original-primary authority.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PublicCreateCurrentness {
    pub(crate) request_id: String,
    pub(crate) if_match: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PublicCreationError {
    InvalidContext,
    SourceChanged,
    WorkingLocationUnavailable,
    ModelUnavailable,
    RequiredAuthorityUnavailable,
    OutcomeUnknown,
}

/// Safe identity projected from the actual retained service, never the request.
pub(crate) struct CreatedSessionIdentity {
    pub(crate) session_id: String,
    pub(crate) behavior: SessionBehavior,
    pub(crate) project_id: Option<String>,
}

impl PublicSessionCreationCommand {
    pub(crate) fn validate(&self) -> Result<(), PublicCreationError> {
        let id = match &self.context {
            PublicCreationContext::Project(id) | PublicCreationContext::WorkingLocation(id) => id,
        };
        if id.is_empty()
            || self.model_config_id.as_ref().is_some_and(String::is_empty)
            || (self.first_chat && !matches!(self.context, PublicCreationContext::Project(_)))
            || (self.first_chat_same_behavior && !self.first_chat)
        {
            return Err(PublicCreationError::InvalidContext);
        }
        Ok(())
    }
}

/// Captured real Native rows/facts for the eventual original operation owner.
/// A caller can construct data here; that NEVER selects the effect entry.
pub(crate) struct CapturedPublicCreateSource {
    pub(crate) request: PublicCreateCurrentness,
    pub(crate) location: ManagedLocationFact,
    pub(crate) project: projects::ProjectLaunchContext,
    pub(crate) model: ModelConfigurationRecord,
}

/// Private resolved command plus SAME retained resources, not an admitted runtime.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "genuine paired CREATE factory consumer is not installed"
    )
)]
pub(crate) struct ResolvedPublicCreateData {
    pub(crate) command: SessionCreationCommand,
    pub(crate) location: PreparedLocationCustody,
}

#[cfg(all(test, unix))]
#[path = "public_session_creation_tests.rs"]
mod tests;

impl SessionCreationApplication<'_> {
    /// The HTTP adapter reaches this original service only after strict decode.
    /// No actual same-operation AFM proof/Core paired consumer is installed yet.
    /// Refuse BEFORE private source reads, backend preparation, writes or spawn.
    pub(crate) fn create_public_session(
        &self,
        command: PublicSessionCreationCommand,
        request: PublicCreateCurrentness,
    ) -> Result<CreatedSessionIdentity, PublicCreationError> {
        command.validate()?;
        if request.request_id.is_empty() {
            return Err(PublicCreationError::InvalidContext);
        }
        Err(PublicCreationError::RequiredAuthorityUnavailable)
    }

    /// Genuine Core factory output only, never selected by a wire DTO/header.
    /// The factory consumes `ResolvedPublicCreateData::command` under its real
    /// captured source reservation before returning this same opaque runtime.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "genuine paired CREATE factory output is not installed"
        )
    )]
    pub(crate) async fn publish_public_prepared(
        &self,
        request: super::managed_create_request::ValidatedManagedCreateRequest,
        admitted: nac_core::session_service::AdmittedSessionPublication,
        location: PreparedLocationCustody,
        execution: Box<dyn nac_core::runtime::PreparationResourceCustody>,
    ) -> Result<CreatedSessionIdentity, PublicCreationError> {
        self.start_admitted_create_transfer(
            admitted,
            location,
            execution,
            super::create_transfer::CreateTransferRequest::Managed(request),
        )
        .wait()
        .await
        .and_then(super::create_transfer::CreateTransferReceipt::into_created_identity)
        .map_err(|_| PublicCreationError::OutcomeUnknown)
    }
}

/// Real currentness/data mapping for the actual factory's captured inputs.
/// Invoked only internally after genuine principal/operation admission exists;
/// this function itself does not issue it or call the ordinary runtime builder.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "genuine same-operation factory input is not installed"
    )
)]
pub(crate) async fn resolve_captured_source(
    manager: &SessionManager,
    command: PublicSessionCreationCommand,
    request: &PublicCreateCurrentness,
    captured: CapturedPublicCreateSource,
) -> Result<ResolvedPublicCreateData, PublicCreationError> {
    command.validate()?;
    if request != &captured.request {
        return Err(PublicCreationError::SourceChanged);
    }
    let PublicCreationContext::Project(project_id) = &command.context else {
        // No public-location registry issuer is installed. Never interpret its
        // opaque ID as cwd, repository root or a billing workspace/profile ID.
        return Err(PublicCreationError::WorkingLocationUnavailable);
    };
    if captured.location.selector
        != (ManagedLocationSelector::RegisteredProject {
            project_id: project_id.clone(),
        })
        || captured.project.project.project_id != *project_id
    {
        return Err(PublicCreationError::SourceChanged);
    }
    let actual = projects::load_project_launch_context(&manager.inner.store_path, project_id)
        .map_err(|_| PublicCreationError::SourceChanged)?;
    if actual != captured.project {
        return Err(PublicCreationError::SourceChanged);
    }
    let selected = command
        .model_config_id
        .as_deref()
        .or(actual.project.default_model_config_id.as_deref())
        .ok_or(PublicCreationError::ModelUnavailable)?;
    if selected != captured.model.config_id {
        return Err(PublicCreationError::SourceChanged);
    }
    let model = model_configurations::load_model_configuration(&manager.inner.store_path, selected)
        .map_err(|_| PublicCreationError::ModelUnavailable)?;
    if model != captured.model {
        return Err(PublicCreationError::SourceChanged);
    }
    let resolution = manager
        .resolve_managed_location_fact(captured.location)
        .await
        .map_err(|_| PublicCreationError::SourceChanged)?;
    let location = PreparedLocationCustody::retain(manager, resolution)
        .await
        .map_err(|_| PublicCreationError::SourceChanged)?;
    // Recheck rows after asynchronous directory/host capture; those guards
    // exclude replacement, not ordinary SQLite model/default writes.
    if projects::load_project_launch_context(&manager.inner.store_path, project_id)
        .map_err(|_| PublicCreationError::SourceChanged)?
        != actual
        || model_configurations::load_model_configuration(&manager.inner.store_path, selected)
            .map_err(|_| PublicCreationError::SourceChanged)?
            != model
    {
        location.deny();
        return Err(PublicCreationError::SourceChanged);
    }
    let mut private = SessionCreationCommand {
        behavior: command.behavior,
        first_chat: command.first_chat,
        first_chat_same_behavior: command.first_chat_same_behavior,
        project_id: Some(project_id.clone()),
        cwd: None,
        ..Default::default()
    };
    apply_project_model_defaults(&mut private, model);
    match command.reasoning_effort {
        Field::Unchanged => {}
        override_value => private.reasoning_effort = override_value,
    }
    Ok(ResolvedPublicCreateData {
        command: private,
        location,
    })
}
