//! Saved project selection for standalone interval tasks. These values carry
//! no invocation authority; admission revalidates the serving store and project.
use super::*;

/// Explicit choices are retained; absent model/reasoning choices inherit the
/// destination's defaults when a new occurrence is prepared.
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FreshTaskDestination {
    pub project_id: String,
    pub pinned_commit: Option<String>,
    /// Used only to establish an unbound project's saved default branch.
    /// An existing binding cannot be silently replaced by this value.
    pub default_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_selection: Option<crate::store::TaskModelSelection>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    pub retained_limit: i64,
}

impl FreshTaskDestination {
    pub fn validate(&self) -> Result<()> {
        if let Some(selection) = &self.model_selection {
            selection.validate()?;
        }
        ensure!(
            !self.project_id.trim().is_empty() && self.project_id.len() <= 256,
            "fresh tasks require an exact saved project identity"
        );
        ensure!(
            self.pinned_commit.as_ref().is_none_or(|commit| {
                matches!(commit.len(), 40 | 64)
                    && commit.bytes().all(|byte| byte.is_ascii_hexdigit())
            }),
            "fresh task pin must be a complete immutable commit identity"
        );
        ensure!(
            (1..=1_000).contains(&self.retained_limit),
            "fresh task retained allowance must be between 1 and 1000"
        );
        for (value, maximum, label) in [
            (&self.default_ref, 1_024, "default branch"),
            (&self.model, 256, "model"),
            (&self.reasoning_effort, 64, "reasoning effort"),
            (&self.service_tier, 64, "service tier"),
        ] {
            ensure!(
                value.as_ref().is_none_or(|value| {
                    !value.trim().is_empty() && value.len() <= maximum && !value.contains('\0')
                }),
                "fresh task {label} must be nonblank and bounded"
            );
        }
        if let Some(tier) = &self.service_tier {
            tier.parse::<crate::model::ServiceTier>()
                .map_err(|error| anyhow::anyhow!(error))?;
        }
        ensure!(
            self.default_ref
                .as_ref()
                .is_none_or(|reference| !reference.starts_with('-')),
            "fresh task default branch cannot begin with an option prefix"
        );
        Ok(())
    }
}

/// Durable reservation data. The host allowance counts this row before any
/// materialization and keeps it after occurrence-history or task deletion.
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct FreshTaskLaunchReceipt {
    pub occurrence_id: String,
    pub schedule_id: String,
    pub request: TaskLaunchRequest,
    pub destination: FreshTaskDestination,
    pub binding: HeartbeatBinding,
    pub session_id: String,
    pub first_input_id: Option<i64>,
    pub stop_requested: bool,
    pub initial_run_id: Option<String>,
    pub initial_outcome: Option<HeartbeatOccurrence>,
    pub shared_directory: Option<bool>,
    pub created_at_ms: i64,
}

/// Issued only after durable schedule/version, ownership and retained-resource
/// admission. Deserializing a passive receipt cannot manufacture this port input.
#[derive(Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct LegacyFrozenModel {
    pub(super) config_id: String,
    pub(super) name: String,
    pub(super) backend: String,
    pub(super) model: String,
    pub(super) base_url: String,
    #[serde(default)]
    pub(super) allow_insecure_http: bool,
    pub(super) api_key_env: Option<String>,
    pub(super) reasoning_effort: Option<String>,
    #[serde(default)]
    pub(super) service_tier: Option<String>,
    pub(super) extra_headers: std::collections::BTreeMap<String, String>,
    #[serde(rename = "orchestrator_compaction_threshold")]
    pub(super) orchestrator_compaction_threshold: Option<u64>,
    pub(super) initial_prompt: Option<String>,
    #[serde(default)]
    pub(super) light_model: Option<serde_json::Value>,
    pub(super) created_at: String,
    pub(super) updated_at: String,
}

#[derive(Clone)]
pub struct PreparedFreshTaskLaunch {
    pub(super) receipt: FreshTaskLaunchReceipt,
    pub(super) model_defaults: Option<LegacyFrozenModel>,
    pub(super) legacy_binding_id: Option<String>,
}

impl PreparedFreshTaskLaunch {
    pub fn receipt(&self) -> &FreshTaskLaunchReceipt {
        &self.receipt
    }

    /// Recover only the immutable model snapshot already bound to an unpublished
    /// historical reservation. This never reads project presets or rewrites intent.
    pub fn legacy_frozen_model(&self) -> Result<Option<crate::store::TaskModelSelection>> {
        let receipt = &self.receipt;
        if receipt.destination.model_selection.is_some()
            || receipt.request.model_selection.is_some()
        {
            return Ok(None);
        }
        let Some(frozen) = &self.model_defaults else {
            return Ok(None);
        };
        ensure!(
            !receipt.stop_requested
                && receipt.first_input_id.is_none()
                && receipt.initial_run_id.is_none()
                && receipt.initial_outcome.is_none(),
            "conflict: historical scheduled launch is no longer unpublished"
        );
        ensure!(
            receipt.request.project_id == receipt.destination.project_id
                && receipt.binding.project_id.as_deref()
                    == Some(receipt.destination.project_id.as_str())
                && receipt.binding.fresh_task.as_ref() == Some(&receipt.destination)
                && match self.legacy_binding_id.as_deref() {
                    Some(id) => id == frozen.config_id,
                    None =>
                        frozen.config_id == format!("scheduled-defaults:{}", receipt.occurrence_id),
                },
            "conflict: historical scheduled model receipt does not match its binding"
        );
        // The predecessor's persisted model configurations and session snapshots
        // only stored positive thresholds; zero represented disabled and was NULL.
        ensure!(
            frozen.orchestrator_compaction_threshold != Some(0),
            "conflict: historical scheduled model receipt is invalid"
        );
        let mut selection = crate::store::TaskModelSelection {
            backend: frozen.backend.clone(),
            model: receipt
                .destination
                .model
                .clone()
                .unwrap_or_else(|| frozen.model.clone()),
            base_url: frozen.base_url.clone(),
            allow_insecure_http: frozen.allow_insecure_http,
            api_key_env: frozen.api_key_env.clone(),
            reasoning_effort: receipt
                .destination
                .reasoning_effort
                .clone()
                .or_else(|| frozen.reasoning_effort.clone()),
            service_tier: receipt
                .destination
                .service_tier
                .clone()
                .or_else(|| frozen.service_tier.clone()),
            extra_headers: Some(frozen.extra_headers.clone()),
            orchestrator_compaction_threshold: frozen.orchestrator_compaction_threshold,
        };
        selection
            .validate()
            .map_err(|_| anyhow!("conflict: historical scheduled model receipt is invalid"))?;
        // The predecessor revalidated an inherited speed when an explicit model
        // override changed its route, falling back to Standard only for Codex.
        if receipt
            .destination
            .model
            .as_ref()
            .is_some_and(|model| model != &frozen.model)
            && receipt.destination.service_tier.is_none()
        {
            if let Some(tier) = selection.service_tier.as_deref() {
                let backend: crate::model::BackendKind = selection
                    .backend
                    .parse()
                    .map_err(|_| anyhow!("invalid historical model backend"))?;
                let tier: crate::model::ServiceTier = tier
                    .parse()
                    .map_err(|_| anyhow!("invalid historical model tier"))?;
                let effort = selection
                    .reasoning_effort
                    .as_ref()
                    .map(|value| serde_json::from_value(serde_json::Value::String(value.clone())))
                    .transpose()
                    .map_err(|_| anyhow!("invalid historical reasoning effort"))?;
                let effective =
                    crate::model::EffectiveModelSettings::from_optional_with_http_policy(
                        Some(backend),
                        Some(selection.model.clone()),
                        Some(selection.base_url.clone()),
                        effort,
                        selection.api_key_env.clone(),
                        selection.extra_headers.clone().unwrap_or_default(),
                        selection.allow_insecure_http,
                    )
                    .map_err(|_| {
                        anyhow!("conflict: historical scheduled model receipt is invalid")
                    })?;
                if effective.clone().with_service_tier(Some(tier)).is_err() {
                    ensure!(
                        backend == crate::model::BackendKind::ChatGptCodexResponses,
                        "conflict: historical scheduled model tier is unavailable"
                    );
                    effective
                        .with_service_tier(Some(crate::model::ServiceTier::Standard))
                        .map_err(|_| {
                            anyhow!("conflict: historical scheduled model tier is unavailable")
                        })?;
                    selection.service_tier = Some("standard".into());
                }
            }
        }
        Ok(Some(selection))
    }

    /// Compare private frozen inputs when re-reading the same leased launch.
    pub fn same_frozen_model(&self, other: &Self) -> bool {
        self.model_defaults == other.model_defaults
            && self.legacy_binding_id == other.legacy_binding_id
    }
}

/// Composition supplies the retained/shared prepared-session adapter. The
/// scheduler does not know HTTP, Git process machinery or provider wire types.
pub trait FreshTaskPreparationPort: Send + Sync {
    fn prepare<'a>(
        &'a self,
        launch: PreparedFreshTaskLaunch,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn destination_retains_explicit_choices_and_rejects_mutable_pins_and_unbounded_resources() {
        let mut destination = FreshTaskDestination {
            project_id: "saved-project".into(),
            model_selection: None,
            pinned_commit: None,
            default_ref: None,
            model: None,
            reasoning_effort: None,
            service_tier: None,
            retained_limit: 10,
        };
        destination.validate().unwrap();
        for pin in [
            "HEAD",
            "dev",
            "012345",
            &"z".repeat(40),
            &"a".repeat(41),
            &"a".repeat(63),
        ] {
            destination.pinned_commit = Some(pin.into());
            assert!(destination.validate().is_err(), "{pin}");
        }
        destination.pinned_commit = Some("a".repeat(40));
        destination.model = Some("selected-model".into());
        destination.reasoning_effort = Some("high".into());
        destination.validate().unwrap();
        let saved = encode(&destination).unwrap();
        assert_eq!(
            serde_json::from_str::<FreshTaskDestination>(&saved).unwrap(),
            destination
        );
        let mut old = serde_json::to_value(&destination).unwrap();
        old.as_object_mut().unwrap().remove("service_tier");
        assert_eq!(
            serde_json::from_value::<FreshTaskDestination>(old)
                .unwrap()
                .service_tier,
            None
        );
        for limit in [0, -1, 1_001, i64::MAX] {
            destination.retained_limit = limit;
            assert!(destination.validate().is_err());
        }
    }
}
