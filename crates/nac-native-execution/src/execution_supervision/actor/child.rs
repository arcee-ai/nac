//! Actual runner-side pipe/PTY ownership, using nac-process's retained workers.
use super::super::{job_wire::Operation, protocol::Command as WireCommand};
use super::stop::RawRunnerCleanup;
use anyhow::{ensure, Context, Result};
use nac_core::runtime::{CompartmentExit, CompartmentFuture, CompartmentReader, CompartmentWriter};
use nac_process::{NativePipe, NativePipeOwner, NativePty, NativePtyProcess};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    os::unix::{ffi::OsStringExt, process::ExitStatusExt},
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::{process::Command, sync::Notify};
use uuid::Uuid;

pub(super) enum Process {
    Pipe(NativePipeOwner),
    Pty(NativePtyProcess),
}
pub(super) struct ChildPorts {
    pub process: Arc<Process>,
    pub input: CompartmentWriter,
    pub output: CompartmentReader,
    pub stderr: Option<CompartmentReader>,
}
pub(super) struct Children {
    state: Mutex<ChildrenState>,
    changed: Notify,
}
struct ChildrenState {
    jobs: BTreeMap<Uuid, Option<Arc<Process>>>,
    stopping: Option<Instant>,
}

impl Process {
    pub(super) fn spawn(
        command: WireCommand,
        operation: Operation,
        original_deadline: Instant,
    ) -> Result<ChildPorts> {
        command.validate()?;
        ensure!(
            Instant::now() < original_deadline,
            "Native target cutoff expired before spawn"
        );
        // Closed wire data only. No inherited environment, stdio descriptors,
        // caller hooks, shell interpolation, credentials or supervisor file RPC.
        let mut child = Command::new(OsString::from_vec(command.program));
        child
            .args(command.args.into_iter().map(OsString::from_vec))
            .current_dir(OsString::from_vec(command.cwd))
            .env_clear()
            .envs(command.environment.into_iter().map(|entry| {
                (
                    OsString::from_vec(entry.name),
                    OsString::from_vec(entry.value),
                )
            }));
        match operation {
            Operation::Pty { rows, cols } => {
                let NativePty {
                    input,
                    output,
                    process,
                } = NativePty::spawn_with_closed_fds(child, rows, cols, original_deadline.into())?;
                Ok(ChildPorts {
                    process: Arc::new(Self::Pty(process)),
                    input: Box::new(input),
                    output: Box::new(output),
                    stderr: None,
                })
            }
            Operation::Execute {} | Operation::Pipe {} | Operation::FileChild {} => {
                let NativePipe {
                    stdin,
                    stdout,
                    stderr,
                    process,
                } = NativePipe::spawn_with_closed_fds(child, original_deadline.into())?;
                Ok(ChildPorts {
                    process: Arc::new(Self::Pipe(process)),
                    input: Box::new(stdin),
                    output: Box::new(stdout),
                    stderr: Some(Box::new(stderr)),
                })
            }
        }
    }
    pub(super) fn stop(&self, deadline: Instant) {
        match self {
            Self::Pipe(process) => process.request_stop_until(deadline.into()),
            Self::Pty(process) => process.request_stop_until(deadline.into()),
        }
    }
    pub(super) async fn wait(&self) -> Result<CompartmentExit> {
        let status = match self {
            Self::Pipe(process) => process.wait().await?,
            Self::Pty(process) => process.wait().await?,
        };
        Ok(CompartmentExit {
            code: status.code(),
            signal: status.signal(),
        })
    }
    pub(super) fn resize(&self, rows: u16, cols: u16) -> Result<()> {
        let Self::Pty(process) = self else {
            anyhow::bail!("Native resize requires PTY job")
        };
        process.resize(rows, cols)?;
        Ok(())
    }
}
impl Children {
    pub(super) fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(ChildrenState {
                jobs: BTreeMap::new(),
                stopping: None,
            }),
            changed: Notify::new(),
        })
    }
    /// Reserve the actual spawn attempt BEFORE entering process creation.
    /// Unknown failed/partial spawns remain pending: no empty-registry success.
    pub(super) fn reserve_spawn(&self, job: Uuid) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ensure!(
            state.stopping.is_none() && !state.jobs.contains_key(&job),
            "Native spawn registration unavailable"
        );
        state.jobs.insert(job, None);
        Ok(())
    }
    pub(super) fn insert(&self, job: Uuid, process: Arc<Process>) -> Result<()> {
        let cutoff = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let entry = state
                .jobs
                .get_mut(&job)
                .context("Native child spawn not registered")?;
            ensure!(entry.is_none(), "Native duplicate child registration");
            *entry = Some(Arc::clone(&process));
            state.stopping
        };
        self.changed.notify_waiters();
        if let Some(cutoff) = cutoff {
            process.stop(cutoff);
            anyhow::bail!("Native target stopped during spawn");
        }
        Ok(())
    }
    pub(super) fn remove_reaped(&self, job: Uuid) -> Result<()> {
        let process = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            ensure!(
                state.jobs.get(&job).is_some_and(Option::is_some),
                "Native reaped child missing or unresolved"
            );
            state.jobs.remove(&job)
        };
        // Removal is only after the job's actual wait succeeded; callers keep
        // any port/metadata owners until their own settlement. No PID escapes.
        drop(process);
        Ok(())
    }
}
impl RawRunnerCleanup for Children {
    fn request_stop(&self, original_deadline: Instant) {
        let (jobs, cutoff) = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let cutoff = original_deadline.min(state.stopping.unwrap_or(original_deadline));
            state.stopping = Some(cutoff);
            (
                state
                    .jobs
                    .values()
                    .filter_map(Clone::clone)
                    .collect::<Vec<_>>(),
                cutoff,
            )
        };
        for job in jobs {
            job.stop(cutoff);
        }
    }
    fn wait_for_reap(&self, _original_deadline: Instant) -> CompartmentFuture<'_, ()> {
        Box::pin(async move {
            loop {
                let changed = self.changed.notified();
                tokio::pin!(changed);
                changed.as_mut().enable();
                let (jobs, pending) = {
                    let state = self
                        .state
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    ensure!(state.stopping.is_some(), "Native children have not stopped");
                    (
                        state
                            .jobs
                            .values()
                            .filter_map(Clone::clone)
                            .collect::<Vec<_>>(),
                        state.jobs.values().any(Option::is_none),
                    )
                };
                for job in jobs {
                    job.wait().await?;
                }
                if !pending {
                    return Ok(());
                }
                // Actual pre-spawn admission remains in flight/unknown. The
                // outer original deadline bounds this observation, not cleanup
                // ownership. Never forget it or report false settlement.
                changed.await;
            }
        })
    }
}

#[cfg(test)]
mod tests;
