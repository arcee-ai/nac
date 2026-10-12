//! A bounded human-input pump keeps a blocked PTY write outside the session
//! map and cancellation gate. Cleanup can still reach the owned child.

use std::io::Write;
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use tokio::sync::oneshot;

use crate::tools::ThreadCancellation;

type InputReceipt = oneshot::Receiver<Result<(), &'static str>>;
struct InputPacket {
    bytes: Vec<u8>,
    receipt: oneshot::Sender<Result<(), &'static str>>,
}

pub(super) enum PtyInput {
    Model(Box<dyn Write + Send>),
    User(UserInput),
}

pub(super) struct UserInput {
    sender: SyncSender<InputPacket>,
    _worker: std::thread::JoinHandle<()>,
}

impl PtyInput {
    pub(super) fn new(writer: Box<dyn Write + Send>, user_owned: bool) -> Result<Self> {
        if !user_owned {
            return Ok(Self::Model(writer));
        }
        // One active write plus one queued packet, each at most 16 KiB. No
        // caller waits for queue capacity or holds the process map during I/O.
        let (sender, receiver) = sync_channel::<InputPacket>(1);
        let worker = std::thread::Builder::new()
            .name("nac-user-pty-input".into())
            .spawn(move || {
                let mut writer = writer;
                while let Ok(packet) = receiver.recv() {
                    let result = writer
                        .write_all(&packet.bytes)
                        .and_then(|()| writer.flush())
                        .map_err(|_| {
                            "terminal input failed; bytes may have been partially delivered"
                        });
                    let failed = result.is_err();
                    let _ = packet.receipt.send(result);
                    if failed {
                        break;
                    }
                }
            })
            .context("Failed to create terminal input worker")?;
        Ok(Self::User(UserInput {
            sender,
            _worker: worker,
        }))
    }

    pub(super) fn write_model(&mut self, bytes: &[u8]) -> Result<()> {
        let Self::Model(writer) = self else {
            return Err(anyhow!("a human terminal does not accept model input"));
        };
        writer.write_all(bytes).context("Failed to write to PTY")?;
        writer.flush().context("Failed to flush PTY")
    }

    pub(super) fn enqueue_user(
        &self,
        bytes: &[u8],
        cancellation: &ThreadCancellation,
    ) -> Result<InputReceipt> {
        let Self::User(input) = self else {
            return Err(anyhow!("terminal is not owned by the human capability"));
        };
        if bytes.len() > 16 * 1024 {
            return Err(anyhow!("terminal input exceeds 16384 bytes"));
        }
        let (sender, receipt) = oneshot::channel();
        cancellation
            .run_if_active(|| {
                input.sender.try_send(InputPacket {
                    bytes: bytes.to_vec(),
                    receipt: sender,
                })
            })
            .ok_or_else(|| anyhow!("user terminal input cancelled before admission"))?
            .map_err(|error| match error {
                TrySendError::Full(_) => {
                    anyhow!("terminal input queue is full; this input was not accepted")
                }
                TrySendError::Disconnected(_) => {
                    anyhow!("terminal input owner stopped; this input was not accepted")
                }
            })?;
        Ok(receipt)
    }

    pub(super) fn flush_model(&mut self) {
        if let Self::Model(writer) = self {
            let _ = writer.flush();
        }
    }
}

pub(super) async fn await_receipt(receipt: InputReceipt) -> Result<()> {
    match tokio::time::timeout(Duration::from_secs(1), receipt).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(error))) => Err(anyhow!(error)),
        Ok(Err(_)) | Err(_) => Err(anyhow!(
            "terminal input was accepted but delivery is unconfirmed; do not retry these bytes"
        )),
    }
}

#[cfg(test)]
#[path = "input_tests.rs"]
mod tests;
