use serde::{Deserialize, Serialize};

/// Stable failure categories carried from execution into durable presentation.
/// Provider-specific wire codes are deliberately collapsed at the adapter edge.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum RunFailureKind {
    Transport,
    Capacity,
    Authentication,
    Validation,
    Configuration,
    Protocol,
    Interrupted,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum RunFailurePhase {
    Request,
    Response,
    Stream,
    Decode,
    Agent,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PartialModelOutput {
    #[serde(default)]
    pub text: bool,
    #[serde(default)]
    pub reasoning: bool,
    #[serde(default)]
    pub tool_call: bool,
}

impl PartialModelOutput {
    pub const fn any(self) -> bool {
        self.text || self.reasoning || self.tool_call
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum RecoveryAction {
    AutomaticRetry,
    ResumeGoal,
    RegenerateWithRewind,
    Settings,
    None,
}

/// Credential-redacted failure metadata suitable for persistence and API use.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct RunFailure {
    pub kind: RunFailureKind,
    pub phase: RunFailurePhase,
    pub transient: bool,
    #[serde(default)]
    pub partial_output: PartialModelOutput,
    pub attempt_count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_after_ms: Option<u64>,
    pub summary: String,
    pub diagnostic: String,
    pub recovery_action: RecoveryAction,
}

impl RunFailure {
    const MAX_EXTERNAL_TEXT_BYTES: usize = 600;

    pub fn unknown(diagnostic: impl Into<String>) -> Self {
        Self {
            kind: RunFailureKind::Unknown,
            phase: RunFailurePhase::Agent,
            transient: false,
            partial_output: PartialModelOutput::default(),
            attempt_count: 1,
            http_status: None,
            retry_after_ms: None,
            summary: "The run stopped before it completed.".to_string(),
            diagnostic: diagnostic.into(),
            recovery_action: RecoveryAction::None,
        }
    }

    pub fn interrupted(diagnostic: impl Into<String>) -> Self {
        Self {
            kind: RunFailureKind::Interrupted,
            phase: RunFailurePhase::Agent,
            transient: true,
            partial_output: PartialModelOutput::default(),
            attempt_count: 1,
            http_status: None,
            retry_after_ms: None,
            summary: "The run was interrupted before it completed.".to_string(),
            diagnostic: diagnostic.into(),
            recovery_action: RecoveryAction::ResumeGoal,
        }
    }

    pub fn with_recovery_action(mut self, action: RecoveryAction) -> Self {
        self.recovery_action = action;
        self
    }

    pub const fn is_interrupted(&self) -> bool {
        matches!(self.kind, RunFailureKind::Interrupted)
    }

    pub fn sanitized(mut self) -> Self {
        self.summary = sanitize_external_text(&self.summary);
        self.diagnostic = sanitize_external_text(&self.diagnostic);
        self
    }
}

fn sanitize_external_text(value: &str) -> String {
    let redacted = crate::model::redact_credentials(value, &[]);
    let mut end = redacted.len().min(RunFailure::MAX_EXTERNAL_TEXT_BYTES);
    while !redacted.is_char_boundary(end) {
        end -= 1;
    }
    redacted[..end].to_string()
}

impl std::fmt::Display for RunFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.diagnostic)
    }
}

impl std::error::Error for RunFailure {}
