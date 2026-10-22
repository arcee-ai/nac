//! Closed data codec. A decoded command is never permission or boundary proof.
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

pub(super) const MAX_COMMAND_BYTES: usize = 256 * 1024;
pub(super) const MAX_ARGUMENTS: usize = 4096;
pub(super) const MAX_ENVIRONMENT: usize = 1024;
pub(super) const MAX_DATA: usize = 16 * 1024;

/// Unix argument/path bytes are preserved, including non-UTF-8 values. Explicit
/// environment entries replace inheritance; duplicate names are invalid.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Command {
    pub program: Vec<u8>,
    pub args: Vec<Vec<u8>>,
    pub cwd: Vec<u8>,
    pub environment: Vec<EnvironmentEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EnvironmentEntry {
    pub name: Vec<u8>,
    pub value: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(super) enum Frame {
    Hello {
        protocol: String,
        boot_id: Uuid,
        challenge_id: Uuid,
    },
    Welcome {
        protocol: String,
        boot_id: Uuid,
        challenge_id: Uuid,
    },
    StartPipe {
        job_id: Uuid,
        command: Command,
    },
    StartPty {
        job_id: Uuid,
        command: Command,
        rows: u16,
        cols: u16,
    },
    Stdin {
        job_id: Uuid,
        data: Vec<u8>,
    },
    StdinEof {
        job_id: Uuid,
    },
    Resize {
        job_id: Uuid,
        rows: u16,
        cols: u16,
    },
    Terminate {
        job_id: Uuid,
    },
    Started {
        job_id: Uuid,
    },
    Stdout {
        job_id: Uuid,
        data: Vec<u8>,
    },
    Stderr {
        job_id: Uuid,
        data: Vec<u8>,
    },
    Exited {
        job_id: Uuid,
        code: Option<i32>,
        signal: Option<i32>,
    },
    Reaped {
        job_id: Uuid,
    },
    Close {},
    Closed {},
}

impl Command {
    pub(super) fn validate(&self) -> Result<()> {
        if self.program.is_empty()
            || self.cwd.first() != Some(&b'/')
            || self.args.len() > MAX_ARGUMENTS
            || self.environment.len() > MAX_ENVIRONMENT
        {
            bail!("invalid execution command shape");
        }
        let mut bytes = 0usize;
        for value in std::iter::once(&self.program)
            .chain(std::iter::once(&self.cwd))
            .chain(self.args.iter())
            .chain(
                self.environment
                    .iter()
                    .flat_map(|entry| [&entry.name, &entry.value]),
            )
        {
            bytes = bytes
                .checked_add(value.len())
                .ok_or_else(|| anyhow::anyhow!("execution command exceeds bound"))?;
            if bytes > MAX_COMMAND_BYTES || value.contains(&0) {
                bail!("invalid execution command bytes");
            }
        }
        let mut names = HashSet::new();
        for entry in &self.environment {
            if entry.name.is_empty() || entry.name.contains(&b'=') || !names.insert(&entry.name) {
                bail!("invalid execution environment name");
            }
        }
        Ok(())
    }
}

impl Frame {
    pub(super) fn validate(&self) -> Result<()> {
        let job = match self {
            Self::Hello { .. } | Self::Welcome { .. } | Self::Close {} | Self::Closed {} => {
                return Ok(())
            }
            Self::StartPipe { job_id, command } => {
                command.validate()?;
                job_id
            }
            Self::StartPty {
                job_id,
                command,
                rows,
                cols,
            } => {
                command.validate()?;
                size(*rows, *cols)?;
                job_id
            }
            Self::Resize { job_id, rows, cols } => {
                size(*rows, *cols)?;
                job_id
            }
            Self::Stdin { job_id, data }
            | Self::Stdout { job_id, data }
            | Self::Stderr { job_id, data } => {
                if data.is_empty() || data.len() > MAX_DATA {
                    bail!("execution data exceeds bound");
                }
                job_id
            }
            Self::Exited {
                job_id,
                code,
                signal,
            } => {
                if code.is_some_and(|value| !(0..=255).contains(&value))
                    || signal.is_some_and(|value| !(1..=64).contains(&value))
                    || (code.is_some() && signal.is_some())
                {
                    bail!("invalid execution exit observation");
                }
                job_id
            }
            Self::StdinEof { job_id }
            | Self::Terminate { job_id }
            | Self::Started { job_id }
            | Self::Reaped { job_id } => job_id,
        };
        if job.is_nil() {
            bail!("missing execution job identity");
        }
        Ok(())
    }
}

fn size(rows: u16, cols: u16) -> Result<()> {
    if rows == 0 || cols == 0 {
        bail!("invalid execution PTY size");
    }
    Ok(())
}

#[cfg(test)]
mod tests;
