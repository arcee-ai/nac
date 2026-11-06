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
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub retained_limit: i64,
}

impl FreshTaskDestination {
    pub fn validate(&self) -> Result<()> {
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
        ] {
            ensure!(
                value.as_ref().is_none_or(|value| {
                    !value.trim().is_empty() && value.len() <= maximum && !value.contains('\0')
                }),
                "fresh task {label} must be nonblank and bounded"
            );
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
#[derive(Clone)]
pub struct PreparedFreshTaskLaunch {
    pub(super) receipt: FreshTaskLaunchReceipt,
    pub(super) model_defaults: Option<ModelConfigurationRecord>,
}

impl PreparedFreshTaskLaunch {
    pub fn receipt(&self) -> &FreshTaskLaunchReceipt {
        &self.receipt
    }

    /// Saved defaults are preparation input, excluded from passive inventory.
    pub fn model_defaults(&self) -> Option<&ModelConfigurationRecord> {
        self.model_defaults.as_ref()
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
            pinned_commit: None,
            default_ref: None,
            model: None,
            reasoning_effort: None,
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
        for limit in [0, -1, 1_001, i64::MAX] {
            destination.retained_limit = limit;
            assert!(destination.validate().is_err());
        }
    }
}
