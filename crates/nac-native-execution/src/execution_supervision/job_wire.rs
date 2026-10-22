//! Private v2 job codec. No dispatcher, ownership, permission or negotiation.
//! The existing v1 exchange never accepts these records. An actual actor must
//! deny its physical owner on any framing/state error, not resume decoding.
use super::protocol::{MAX_ARGUMENTS, MAX_COMMAND_BYTES, MAX_DATA, MAX_ENVIRONMENT};
use super::MAX_FRAME;
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use uuid::Uuid;

pub(super) mod assembly;
pub(super) mod command;
pub(super) mod flow;

// Each byte uses at most four JSON bytes ("255,"). Fixed record metadata has
// at most 1024 bytes; exact maximum-field serialization is tested separately.
pub(super) const MAX_FRAGMENT: usize = 768;
pub(super) const MAX_ENCODED_COMMAND: usize =
    MAX_COMMAND_BYTES + 4 * (4 + MAX_ARGUMENTS + 2 * MAX_ENVIRONMENT);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Direction {
    ToRunner,
    ToClient,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(tag = "mode", deny_unknown_fields)]
pub(super) enum Operation {
    Execute {},
    Pipe {},
    Pty { rows: u16, cols: u16 },
    FileChild {},
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) enum Stream {
    Stdin,
    Stdout,
    Stderr,
    PtyOutput,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub(super) enum Frame {
    BeginCommand {
        job_id: Uuid,
        operation: Operation,
        encoded_bytes: u32,
    },
    CommandFragment {
        job_id: Uuid,
        offset: u32,
        data: Vec<u8>,
    },
    CommitCommand {
        job_id: Uuid,
    },
    BeginData {
        job_id: Uuid,
        stream: Stream,
        block: u64,
        bytes: u32,
    },
    DataFragment {
        job_id: Uuid,
        stream: Stream,
        block: u64,
        offset: u32,
        data: Vec<u8>,
    },
    EndData {
        job_id: Uuid,
        stream: Stream,
        block: u64,
    },
    Credit {
        job_id: Uuid,
        stream: Stream,
        upto: u64,
    },
    StdinEof {
        job_id: Uuid,
    },
    Resize {
        job_id: Uuid,
        control_id: u64,
        rows: u16,
        cols: u16,
    },
    Resized {
        job_id: Uuid,
        control_id: u64,
    },
    Terminate {
        job_id: Uuid,
    },
    InputClosed {
        job_id: Uuid,
    },
    Started {
        job_id: Uuid,
    },
    Exited {
        job_id: Uuid,
        code: Option<i32>,
        signal: Option<i32>,
    },
    Reaped {
        job_id: Uuid,
    },
    // Client fences all outstanding per-job sends before this final record.
    Released {
        job_id: Uuid,
    },
    Close {},
    Closed {},
}

impl Frame {
    fn validate(&self, direction: Direction) -> Result<()> {
        let (job, expected) = match self {
            Self::Close {} => (None, Direction::ToRunner),
            Self::Closed {} => (None, Direction::ToClient),
            Self::BeginCommand {
                job_id,
                operation,
                encoded_bytes,
            } => {
                ensure!(
                    (1..=MAX_ENCODED_COMMAND).contains(&(*encoded_bytes as usize)),
                    "invalid command length"
                );
                if let Operation::Pty { rows, cols } = operation {
                    ensure!(*rows != 0 && *cols != 0, "invalid PTY dimensions");
                }
                (Some(job_id), Direction::ToRunner)
            }
            Self::CommandFragment {
                job_id,
                offset,
                data,
            } => {
                fragment(data, *offset, MAX_ENCODED_COMMAND)?;
                (Some(job_id), Direction::ToRunner)
            }
            Self::CommitCommand { job_id }
            | Self::StdinEof { job_id }
            | Self::Terminate { job_id }
            | Self::Released { job_id } => (Some(job_id), Direction::ToRunner),
            Self::Resize {
                job_id,
                control_id,
                rows,
                cols,
            } => {
                ensure!(*control_id != 0, "invalid resize control identity");
                ensure!(*rows != 0 && *cols != 0, "invalid PTY dimensions");
                (Some(job_id), Direction::ToRunner)
            }
            Self::BeginData {
                job_id,
                stream,
                bytes,
                ..
            } => {
                ensure!(
                    (1..=MAX_DATA).contains(&(*bytes as usize)),
                    "invalid data length"
                );
                (Some(job_id), stream.direction())
            }
            Self::DataFragment {
                job_id,
                stream,
                offset,
                data,
                ..
            } => {
                fragment(data, *offset, MAX_DATA)?;
                (Some(job_id), stream.direction())
            }
            Self::EndData { job_id, stream, .. } => (Some(job_id), stream.direction()),
            Self::Credit {
                job_id,
                stream,
                upto,
            } => {
                ensure!(*upto != 0, "invalid credit limit");
                (Some(job_id), stream.direction().opposite())
            }
            Self::Exited {
                job_id,
                code,
                signal,
            } => {
                ensure!(
                    !code.is_some_and(|v| !(0..=255).contains(&v))
                        && !signal.is_some_and(|v| !(1..=64).contains(&v))
                        && !(code.is_some() && signal.is_some()),
                    "invalid exit observation"
                );
                (Some(job_id), Direction::ToClient)
            }
            Self::Resized { job_id, control_id } => {
                ensure!(*control_id != 0, "invalid resize control identity");
                (Some(job_id), Direction::ToClient)
            }
            Self::Started { job_id } | Self::Reaped { job_id } | Self::InputClosed { job_id } => {
                (Some(job_id), Direction::ToClient)
            }
        };
        ensure!(
            direction == expected && job.is_none_or(|id| !id.is_nil()),
            "invalid job frame direction/identity"
        );
        Ok(())
    }
}

impl Stream {
    fn direction(self) -> Direction {
        if self == Self::Stdin {
            Direction::ToRunner
        } else {
            Direction::ToClient
        }
    }
}

impl Direction {
    pub(super) fn opposite(self) -> Self {
        match self {
            Self::ToRunner => Self::ToClient,
            Self::ToClient => Self::ToRunner,
        }
    }
}

fn fragment(data: &[u8], offset: u32, limit: usize) -> Result<()> {
    ensure!(
        !data.is_empty()
            && data.len() <= MAX_FRAGMENT
            && (offset as usize)
                .checked_add(data.len())
                .is_some_and(|end| end <= limit),
        "invalid job fragment"
    );
    Ok(())
}

pub(super) async fn read(
    stream: &mut (impl AsyncRead + Unpin + Send),
    direction: Direction,
) -> Result<Frame> {
    let len = stream.read_u32().await? as usize;
    ensure!((1..=MAX_FRAME).contains(&len), "job frame exceeds bound");
    let mut raw = vec![0; len];
    stream.read_exact(&mut raw).await?;
    let frame: Frame = serde_json::from_slice(&raw).context("invalid closed job frame")?;
    frame.validate(direction)?;
    Ok(frame)
}

pub(super) async fn write(
    stream: &mut (impl AsyncWrite + Unpin + Send),
    direction: Direction,
    frame: &Frame,
) -> Result<()> {
    let raw = encode(direction, frame)?;
    stream.write_u32(raw.len().try_into()?).await?;
    stream.write_all(&raw).await?;
    Ok(())
}

pub(super) fn encode(direction: Direction, frame: &Frame) -> Result<Vec<u8>> {
    frame.validate(direction)?;
    let raw = serde_json::to_vec(frame)?;
    ensure!(
        (1..=MAX_FRAME).contains(&raw.len()),
        "job frame exceeds bound"
    );
    Ok(raw)
}

#[cfg(test)]
mod tests;
