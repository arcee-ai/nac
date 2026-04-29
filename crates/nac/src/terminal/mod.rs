mod keyparse;
mod manager;
mod session;

pub use keyparse::parse_keys;
pub use manager::TerminalManager;
pub use session::TerminalSession;

use serde::Serialize;
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

#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutput {
    pub output: String,
    pub exit_code: Option<i32>,
    pub session_name: Option<String>,
    pub wall_time_ms: u64,
    pub output_truncated: bool,
}
