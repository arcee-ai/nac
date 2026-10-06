//! Human shell submissions are durable operations, independent of model turns.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DEFAULT_SHELL_TIMEOUT_MS: u64 = 30_000;
pub const MAX_SHELL_TIMEOUT_MS: u64 = 3_600_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ShellCommandRequest {
    pub request_id: String,
    pub command: String,
    pub timeout_ms: Option<u64>,
}

impl ShellCommandRequest {
    pub(crate) fn validate(&self) -> anyhow::Result<u64> {
        anyhow::ensure!(
            !self.request_id.is_empty() && self.request_id.len() <= 128,
            "request_id must contain between 1 and 128 bytes"
        );
        anyhow::ensure!(!self.command.trim().is_empty(), "command must not be blank");
        let timeout = self.timeout_ms.unwrap_or(DEFAULT_SHELL_TIMEOUT_MS);
        anyhow::ensure!(
            (1..=MAX_SHELL_TIMEOUT_MS).contains(&timeout),
            "timeout_ms must be between 1 and 3600000"
        );
        Ok(timeout)
    }

    pub(crate) fn fingerprint(&self, timeout: u64) -> String {
        let mut hash = Sha256::new();
        hash.update(b"nac-human-shell-v1\0");
        hash.update((self.command.len() as u64).to_le_bytes());
        hash.update(self.command.as_bytes());
        hash.update(timeout.to_le_bytes());
        format!("{:x}", hash.finalize())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ShellCommandState {
    Accepted,
    Started,
    Completed,
    TimedOut,
    Cancelled,
    Rejected,
    SpawnFailed,
    Interrupted,
    OutcomeUnknown,
}

impl ShellCommandState {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Accepted | Self::Started)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ShellCommandSnapshot {
    pub request_id: String,
    pub operation_id: String,
    /// Credential literals are masked before this projection is persisted.
    pub command: String,
    pub timeout_ms: u64,
    pub state: ShellCommandState,
    pub accepted_at_epoch_ms: u64,
    pub finished_at_epoch_ms: Option<u64>,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub diagnostic: Option<String>,
    pub output_id: Option<String>,
    pub transcript_index: Option<u64>,
}

/// This capability cannot be decoded from model arguments. Its constructor is
/// private to the lifecycle owner that has committed the human's exact intent.
pub(crate) struct SubmittedShell {
    command: String,
    timeout_ms: u64,
}

impl SubmittedShell {
    pub(super) fn accepted(command: String, timeout_ms: u64) -> Self {
        Self {
            command,
            timeout_ms,
        }
    }

    pub(crate) fn tool_input(&self) -> serde_json::Value {
        serde_json::json!({ "cmd": self.command, "tty": false,
            "yield_time_ms": self.timeout_ms,
            "_nac": { "timeout_ms": self.timeout_ms } })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellCommandError {
    Invalid(String),
    Unsupported,
    Busy,
    Conflict,
    Store(String),
}

impl std::fmt::Display for ShellCommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(detail) | Self::Store(detail) => f.write_str(detail),
            Self::Unsupported => {
                f.write_str("shell commands require an idle direct-primary session")
            }
            Self::Busy => f.write_str("session is busy with another operation"),
            Self::Conflict => f.write_str("request_id already identifies a different command"),
        }
    }
}
impl std::error::Error for ShellCommandError {}
