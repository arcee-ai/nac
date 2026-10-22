//! Per-job outbound scheduler. Receive routing never waits on these writes.
use super::super::{
    job_wire::{Frame, Operation, Stream},
    protocol::MAX_DATA,
    wire_pump::WireSender,
};
use super::{byte_queue, client_job::ClientJob, send};
use anyhow::{ensure, Result};
use std::sync::Arc;
use tokio::{io::AsyncReadExt, sync::oneshot};

pub(super) struct BeginTurn {
    pub previous: Option<oneshot::Receiver<()>>,
    pub next: oneshot::Sender<()>,
}
impl BeginTurn {
    pub(super) async fn begin(
        self,
        job: &ClientJob,
        wire: &WireSender,
        operation: Operation,
        bytes: usize,
    ) -> Result<()> {
        if let Some(previous) = self.previous {
            tokio::select! {
                result = previous => result.map_err(|_| anyhow::anyhow!("Native preceding begin outcome unknown"))?,
                _ = job.scope.invalidated() => anyhow::bail!("Native begin admission invalidated"),
            }
        }
        wire.send(
            Frame::BeginCommand {
                job_id: job.id,
                operation,
                encoded_bytes: bytes.try_into()?,
            },
            job.deadline,
        )
        .await?;
        // The next identity may BEGIN after this actual write completes; it
        // need not wait for our independent fragmented body, child or output.
        self.next
            .send(())
            .map_err(|()| anyhow::anyhow!("Native begin admission owner ended"))?;
        Ok(())
    }
}

pub(super) async fn run(
    job: &Arc<ClientJob>,
    wire: &WireSender,
    operation: Operation,
    encoded: Vec<u8>,
    initial: Option<Vec<u8>>,
    input: byte_queue::Reader,
    turn: BeginTurn,
) -> Result<()> {
    turn.begin(job, wire, operation, encoded.len()).await?;
    send::command(wire, job.id, &encoded, job.deadline).await?;
    job.state
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .committed = true;
    wire.send(Frame::CommitCommand { job_id: job.id }, job.deadline)
        .await?;
    drop(encoded);
    let mut initial = initial;
    let mut offset = 0;
    let mut input = Some(input);
    let mut buffer = [0; MAX_DATA];
    loop {
        let changed = job.changed.notified();
        tokio::pin!(changed);
        changed.as_mut().enable();
        job.scope.check()?;
        let (started, reaped, eof, terminate, resize) = {
            let mut state = job
                .state
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let terminate = std::mem::take(&mut state.terminate);
            let resize = state
                .resize
                .as_mut()
                .filter(|resize| !resize.queued)
                .map(|resize| {
                    resize.queued = true;
                    (resize.id, resize.size)
                });
            (
                state.started,
                state.reaped,
                state.stdin_eof,
                terminate,
                resize,
            )
        };
        if reaped {
            ensure!(
                eof && resize.is_none(),
                "Native release has unfinished controls"
            );
            wire.send(Frame::Released { job_id: job.id }, job.deadline)
                .await?;
            return Ok(());
        }
        if !started {
            tokio::select! { _ = &mut changed => {}, _ = job.scope.invalidated() => anyhow::bail!("Native dispatch invalidated") }
            continue;
        }
        if terminate {
            wire.send(Frame::Terminate { job_id: job.id }, job.deadline)
                .await?;
        }
        if let Some((control_id, size)) = resize {
            wire.send(
                Frame::Resize {
                    job_id: job.id,
                    control_id,
                    rows: size.rows,
                    cols: size.cols,
                },
                job.deadline,
            )
            .await?;
        }
        for (stream, flow) in [
            (Stream::Stdout, Some(&job.output)),
            (Stream::Stderr, job.stderr.as_ref()),
        ] {
            if let Some(flow) = flow {
                if let Some(upto) = flow.take_credit() {
                    let stream = if job.stderr.is_none() {
                        Stream::PtyOutput
                    } else {
                        stream
                    };
                    wire.send(
                        Frame::Credit {
                            job_id: job.id,
                            stream,
                            upto,
                        },
                        job.deadline,
                    )
                    .await?;
                }
            }
        }
        if !job.input_open() && !eof {
            initial.take();
            input.take();
            send_eof(job, wire).await?;
            continue;
        }
        let available = job.input.available()?.min(MAX_DATA);
        if let Some(bytes) = &initial {
            if offset == bytes.len() {
                initial.take();
                continue;
            }
            if available > 0 && !eof {
                let end = (offset + available).min(bytes.len());
                let block = job.input.reserve(end - offset)?;
                send::data(
                    wire,
                    job.id,
                    Stream::Stdin,
                    block,
                    &bytes[offset..end],
                    job.deadline,
                )
                .await?;
                offset = end;
                continue;
            }
        }
        tokio::select! {
            _ = job.scope.invalidated() => anyhow::bail!("Native job invalidated"),
            _ = &mut changed => {},
            bytes = async { input.as_mut().ok_or_else(|| std::io::Error::other("Native input queue missing"))?.read(&mut buffer[..available]).await },
                if initial.is_none() && !eof && available > 0 => {
                let bytes = bytes?;
                if bytes == 0 {
                    input.take(); send_eof(job, wire).await?;
                } else {
                    // Preserve a complete already-read group through natural
                    // exit/InputClosed races. No partial logical group abort.
                    let block = job.input.reserve(bytes)?;
                    send::data(wire, job.id, Stream::Stdin, block, &buffer[..bytes], job.deadline).await?;
                }
            }
        }
    }
}
async fn send_eof(job: &ClientJob, wire: &WireSender) -> Result<()> {
    {
        let mut state = job
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        ensure!(!state.stdin_eof, "Native duplicate local stdin EOF");
        // The peer can observe EOF/Reaped before the local write ack resumes.
        state.stdin_eof = true;
    }
    wire.send(Frame::StdinEof { job_id: job.id }, job.deadline)
        .await
}
