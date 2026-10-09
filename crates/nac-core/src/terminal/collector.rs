//! PTY collection sanitizes user-owned output before bounded retention.

use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use nac_contracts::CommandOutputRedactor;
use tokio::sync::Notify;

use super::{OutputRegistry, OutputStream};

#[derive(Clone, Default)]
pub(super) struct CollectorState {
    complete: Arc<AtomicBool>,
    error: Arc<Mutex<Option<&'static str>>>,
}

impl CollectorState {
    pub(super) fn complete(&self) -> bool {
        self.complete.load(Ordering::Acquire)
    }

    pub(super) fn error(&self) -> Option<&'static str> {
        *self
            .error
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn fail(&self, message: &'static str) {
        *self
            .error
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(message);
    }
}

pub(super) struct PtyCollector {
    pub registry: OutputRegistry,
    pub output_id: String,
    pub redactor: Option<CommandOutputRedactor>,
    pub alive: Arc<AtomicBool>,
    pub notify: Arc<Notify>,
    pub state: CollectorState,
}

impl PtyCollector {
    pub(super) fn collect(mut self, mut reader: impl Read) {
        let mut buffer = [0; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    self.finish();
                    break;
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                // Linux PTY masters report EIO when the final slave closes.
                #[cfg(target_os = "linux")]
                Err(error) if error.raw_os_error() == Some(libc::EIO) => {
                    self.finish();
                    break;
                }
                Err(_) => {
                    // An unconfirmed read failure is not a safe EOF flush:
                    // pending bytes may still be a credential prefix.
                    self.state.fail("terminal output read failed");
                    break;
                }
                Ok(count) => {
                    let bytes = match self.redactor.as_mut() {
                        Some(redactor) => redactor.push(&buffer[..count]),
                        None => buffer[..count].to_vec(),
                    };
                    if !self.append(bytes) {
                        break;
                    }
                }
            }
        }
        self.alive.store(false, Ordering::SeqCst);
        self.state.complete.store(true, Ordering::Release);
        self.notify.notify_waiters();
        self.notify.notify_one();
    }

    fn finish(&mut self) {
        if let Some(redactor) = self.redactor.take() {
            self.append(redactor.finish());
        }
    }

    fn append(&self, bytes: Vec<u8>) -> bool {
        if bytes.is_empty() {
            return true;
        }
        if self
            .registry
            .append(&self.output_id, OutputStream::Combined, bytes)
            .is_err()
        {
            self.state.fail("terminal output retention failed");
            return false;
        }
        self.notify.notify_waiters();
        self.notify.notify_one();
        true
    }
}

#[cfg(test)]
#[path = "collector_tests.rs"]
mod tests;
