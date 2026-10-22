//! Mirrors AFM's maintained public-native creation DATA contract, not its issuer.
use super::super::contracts::RequestField;
use crate::application::{
    public_session_creation::{
        PublicCreationContext, PublicCreationError, PublicSessionCreationCommand,
    },
    Field,
};
use nac_core::sessions::SessionBehavior;
use serde::{Deserialize, Serialize};

fn required_nullable<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    Option::deserialize(d)
}

#[derive(Clone, Debug, Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct PublicNacCreateSession {
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub(crate) project_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub(crate) working_location_id: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub(crate) model_config_id: Option<String>,
    #[serde(default)]
    #[schema(value_type = Option<String>, required = false)]
    pub(crate) reasoning_effort: RequestField<String>,
    pub(crate) behavior: SessionBehavior,
    pub(crate) first_chat: bool,
    pub(crate) first_chat_same_behavior: bool,
}
impl PublicNacCreateSession {
    pub(crate) fn into_command(self) -> Result<PublicSessionCreationCommand, PublicCreationError> {
        let context = match (self.project_id, self.working_location_id) {
            (Some(id), None) => PublicCreationContext::Project(id),
            (None, Some(id)) => PublicCreationContext::WorkingLocation(id),
            _ => return Err(PublicCreationError::InvalidContext),
        };
        let command = PublicSessionCreationCommand {
            context,
            model_config_id: self.model_config_id,
            behavior: self.behavior,
            first_chat: self.first_chat,
            first_chat_same_behavior: self.first_chat_same_behavior,
            reasoning_effort: match self.reasoning_effort {
                RequestField::Omitted => Field::Unchanged,
                RequestField::Null => Field::Clear,
                RequestField::Value(value) => Field::Set(value),
            },
        };
        command.validate()?;
        Ok(command)
    }
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct PublicNacCreatedSession {
    pub(crate) session_id: String,
    pub(crate) behavior: SessionBehavior,
    #[serde(deserialize_with = "required_nullable")]
    #[schema(required = true)]
    pub(crate) project_id: Option<String>,
}
impl From<crate::application::public_session_creation::CreatedSessionIdentity>
    for PublicNacCreatedSession
{
    fn from(value: crate::application::public_session_creation::CreatedSessionIdentity) -> Self {
        Self {
            session_id: value.session_id,
            behavior: value.behavior,
            project_id: value.project_id,
        }
    }
}
