//! A bounded input pump keeps a blocked PTY write outside the session
//! map and cancellation gate. Cleanup can still reach the owned child.

use std::io::Write;
use std::sync::mpsc::{sync_channel, SyncSender, TrySendError};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use tokio::sync::oneshot;

use super::controller::{InputControl, InputController, InputTicket};
use crate::tools::ThreadCancellation;

pub(super) type InputReceipt = oneshot::Receiver<Result<(), InputWriteError>>;
#[derive(Debug)]
pub(super) enum InputWriteError {
    Rejected(&'static str),
    Unconfirmed(&'static str),
}
struct InputPacket {
    bytes: Vec<u8>,
    ticket: InputTicket,
    receipt: oneshot::Sender<Result<(), InputWriteError>>,
}

pub(super) struct PtyInput {
    input: UserInput,
    pub(super) control: InputControl,
}

pub(super) struct UserInput {
    sender: SyncSender<InputPacket>,
    _worker: std::thread::JoinHandle<()>,
}

impl PtyInput {
    pub(super) fn new(writer: Box<dyn Write + Send>, user_owned: bool) -> Result<Self> {
        let control = InputControl::new(if user_owned {
            InputController::Human
        } else {
            InputController::Agent
        });
        let worker_control = control.clone();
        // One active write plus one queued packet (human packets <=16 KiB). No
        // caller waits for queue capacity or holds the process map during I/O.
        let (sender, receiver) = sync_channel::<InputPacket>(1);
        let worker = std::thread::Builder::new()
            .name("nac-pty-input".into())
            .spawn(move || {
                let mut writer = writer;
                while let Ok(packet) = receiver.recv() {
                    if worker_control.begin(&packet.ticket).is_err() {
                        let _ = packet.receipt.send(Err(InputWriteError::Rejected(
                            "terminal input admission was revoked; queued input was not written",
                        )));
                        continue;
                    }
                    let result = writer
                        .write_all(&packet.bytes)
                        .and_then(|()| writer.flush())
                        .map_err(|_| {
                            InputWriteError::Unconfirmed(
                                "terminal input failed; bytes may have been partially delivered",
                            )
                        });
                    let failed = result.is_err();
                    worker_control.finish(failed);
                    let _ = packet.receipt.send(result);
                    if failed {
                        break;
                    }
                }
            })
            .context("Failed to create terminal input worker")?;
        Ok(Self {
            control,
            input: UserInput {
                sender,
                _worker: worker,
            },
        })
    }

    #[cfg(test)]
    pub(super) fn enqueue_user(
        &self,
        bytes: &[u8],
        cancellation: &ThreadCancellation,
    ) -> Result<InputReceipt> {
        let ticket = self.control.ticket("", InputController::Human)?;
        self.enqueue(bytes, ticket, cancellation)
    }

    pub(super) fn enqueue(
        &self,
        bytes: &[u8],
        ticket: InputTicket,
        cancellation: &ThreadCancellation,
    ) -> Result<InputReceipt> {
        self.control.validate(&ticket)?;
        let input = &self.input;
        if ticket.controller == InputController::Human && bytes.len() > 16 * 1024 {
            return Err(anyhow!("terminal input exceeds 16384 bytes"));
        }
        let (sender, receipt) = oneshot::channel();
        cancellation
            .run_if_active(|| {
                input.sender.try_send(InputPacket {
                    bytes: bytes.to_vec(),
                    ticket,
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
}

pub(super) async fn await_delivery(receipt: InputReceipt) -> super::InputDeliveryReceipt {
    use super::{InputDeliveryOutcome as Outcome, InputDeliveryReceipt};
    let (outcome, error) = match tokio::time::timeout(Duration::from_secs(1), receipt).await {
        Ok(Ok(Ok(()))) => (Outcome::Written, None),
        Ok(Ok(Err(InputWriteError::Rejected(error)))) => (Outcome::Rejected, Some(error.into())),
        Ok(Ok(Err(InputWriteError::Unconfirmed(error)))) => {
            (Outcome::Unconfirmed, Some(error.into()))
        }
        Ok(Err(_)) | Err(_) => (
            Outcome::Unconfirmed,
            Some(
                "terminal input was accepted but delivery is unconfirmed; do not retry these bytes"
                    .into(),
            ),
        ),
    };
    InputDeliveryReceipt { outcome, error }
}

pub(super) async fn await_receipt(receipt: InputReceipt) -> Result<()> {
    await_delivery(receipt).await.into_result()
}

#[cfg(test)]
#[path = "input_tests.rs"]
mod tests;
