use super::{model_configuration_error, BackendKind, EffectiveModelSettings};
use anyhow::Result;
use serde::{Deserialize, Serialize};

/// A person's explicit Codex speed selection. Absence inherits provider defaults.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ServiceTier {
    Standard,
    Fast,
    Ultrafast,
}

impl ServiceTier {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Fast => "fast",
            Self::Ultrafast => "ultrafast",
        }
    }

    pub(crate) fn codex_request_value(self) -> Option<&'static str> {
        match self {
            Self::Standard => None,
            Self::Fast => Some("priority"),
            Self::Ultrafast => Some("ultrafast"),
        }
    }
}

impl std::str::FromStr for ServiceTier {
    type Err = String;
    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "standard" => Ok(Self::Standard),
            "fast" => Ok(Self::Fast),
            "ultrafast" => Ok(Self::Ultrafast),
            _ => Err(format!(
                "unsupported speed '{value}'; select standard, fast, or ultrafast"
            )),
        }
    }
}

impl std::fmt::Display for ServiceTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl EffectiveModelSettings {
    /// Restore saved intent without rewriting or rejecting a now-revoked choice.
    /// The send boundary validates it against the current account observation.
    pub(crate) fn with_saved_service_tier(mut self, tier: Option<ServiceTier>) -> Self {
        self.service_tier = tier;
        self
    }

    /// Validate a newly selected tier against current account capabilities.
    pub fn with_service_tier(mut self, tier: Option<ServiceTier>) -> Result<Self> {
        validate_service_tier(self.backend, &self.resolved, tier)?;
        self.service_tier = tier;
        Ok(self)
    }
}

pub(crate) fn validate_service_tier(
    backend: BackendKind,
    metadata: &super::catalog::ModelMetadata,
    tier: Option<ServiceTier>,
) -> Result<()> {
    if let Some(tier) = tier {
        if backend != BackendKind::ChatGptCodexResponses {
            return Err(model_configuration_error("speed selection is unavailable for this model route; choose a supported model or clear the speed preference"));
        }
        if let Some(id) = tier.codex_request_value() {
            if !metadata
                .service_tiers
                .as_ref()
                .is_some_and(|tiers| tiers.iter().any(|t| t.id == id))
            {
                return Err(model_configuration_error(format!("the selected speed '{}' is unavailable for this account and model; choose Standard or clear the speed preference in settings", tier.as_str())));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preference_serialization_and_wire_mapping_are_distinct() {
        assert_eq!(
            serde_json::to_string(&ServiceTier::Standard).unwrap(),
            "\"standard\""
        );
        assert_eq!(ServiceTier::Standard.codex_request_value(), None);
        assert_eq!(ServiceTier::Fast.codex_request_value(), Some("priority"));
        assert_eq!(
            ServiceTier::Ultrafast.codex_request_value(),
            Some("ultrafast")
        );
        assert_eq!("fast".parse::<ServiceTier>().unwrap(), ServiceTier::Fast);
        assert!("priority".parse::<ServiceTier>().is_err());
    }
    #[test]
    fn revocation_requires_repair_and_standard_remains_safe() {
        let mut metadata =
            super::super::catalog::resolve(BackendKind::ChatGptCodexResponses, "fixture-new-model");
        metadata.service_tiers = Some(vec![super::super::catalog::ModelServiceTier {
            id: "priority".into(),
            name: "Fast".into(),
            description: "Priority processing".into(),
        }]);
        assert!(validate_service_tier(
            BackendKind::ChatGptCodexResponses,
            &metadata,
            Some(ServiceTier::Fast)
        )
        .is_ok());
        metadata.service_tiers = Some(vec![]);
        let error = validate_service_tier(
            BackendKind::ChatGptCodexResponses,
            &metadata,
            Some(ServiceTier::Fast),
        )
        .unwrap_err()
        .to_string();
        assert!(error.contains("unavailable"));
        assert!(validate_service_tier(
            BackendKind::ChatGptCodexResponses,
            &metadata,
            Some(ServiceTier::Standard)
        )
        .is_ok());
        assert!(validate_service_tier(
            BackendKind::OpenAiResponses,
            &metadata,
            Some(ServiceTier::Standard)
        )
        .is_err());
    }
    #[test]
    fn revoked_saved_intent_can_be_restored_for_repair() {
        let settings = EffectiveModelSettings::from_optional(
            Some(BackendKind::ChatGptCodexResponses),
            Some("fixture-unknown".into()),
            None,
            None,
            None,
            Default::default(),
        )
        .unwrap()
        .with_saved_service_tier(Some(ServiceTier::Fast));
        assert_eq!(settings.service_tier, Some(ServiceTier::Fast));
        assert!(
            validate_service_tier(settings.backend, &settings.resolved, settings.service_tier)
                .is_err()
        );
    }
}
