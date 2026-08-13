mod keyparse;
mod manager;
mod output;
mod session;

pub use manager::TerminalManager;
pub use output::{
    ArtifactKind, CommandOutputLimits, OutputPage, OutputRegistry, OutputStream,
    DEFAULT_COMMAND_OUTPUT_MAX_BYTES, DEFAULT_COMMAND_OUTPUT_SESSION_MAX_BYTES,
    DEFAULT_OUTPUT_PAGE_BYTES, MAX_OUTPUT_PAGE_BYTES,
};

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct TerminalInfo {
    pub name: String,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
    pub alive: bool,
    pub idle_ms: u64,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CommandStatus {
    Completed,
    TimedOut,
    Cancelled,
    SpawnError,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommandOutput {
    pub status: CommandStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub wall_time_ms: u64,
    pub stdout_preview: String,
    pub stderr_preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_id: Option<String>,
    pub stdout_bytes: u64,
    pub stderr_bytes: u64,
    pub truncated: bool,
    pub overflowed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutput {
    pub session_name: Option<String>,
    pub output_id: String,
    pub start_cursor: u64,
    pub end_cursor: u64,
    pub content_preview: String,
    pub truncated: bool,
    pub overflowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    pub wall_time_ms: u64,
}
