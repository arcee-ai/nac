//! Cumulative per-stream byte credit. The actor still owns job/EOF identity,
//! physical checks, actual buffers and deadlines; these counters grant no work.
use super::MAX_DATA;
use anyhow::{ensure, Context, Result};
use std::num::NonZeroU64;

pub(in super::super) struct CreditSender {
    window: NonZeroU64,
    sent: u64,
    granted: u64,
    failed: bool,
}

impl CreditSender {
    pub(in super::super) fn new(window: NonZeroU64) -> Self {
        Self {
            window,
            sent: 0,
            granted: 0,
            failed: false,
        }
    }

    /// Strictly advancing absolute limits, bounded by the original window and
    /// bytes actually submitted. No duplicate, rewind, wrap or new window.
    pub(in super::super) fn grant(&mut self, upto: u64) -> Result<()> {
        let result = (|| {
            ensure!(!self.failed, "credit stream denied");
            let maximum = self
                .sent
                .checked_add(self.window.get())
                .context("credit overflow")?;
            ensure!(
                upto > self.granted
                    && upto <= maximum
                    && (self.granted != 0 || upto == self.window.get()),
                "invalid credit advance"
            );
            self.granted = upto;
            Ok(())
        })();
        self.failed |= result.is_err();
        result
    }

    pub(in super::super) fn available(&self) -> Result<u64> {
        ensure!(!self.failed, "credit stream denied");
        Ok(self.granted - self.sent)
    }

    /// None is normal backpressure; it changes no counters. A successful
    /// reservation returns the exact next block's absolute byte offset. A
    /// cancelled/partial wire write cannot return that reservation for replay.
    pub(in super::super) fn try_take(&mut self, bytes: usize) -> Result<Option<u64>> {
        let result = (|| {
            ensure!(
                !self.failed && (1..=MAX_DATA).contains(&bytes),
                "invalid data reservation"
            );
            let end = self
                .sent
                .checked_add(bytes as u64)
                .context("data counter overflow")?;
            if end > self.granted {
                return Ok(None);
            }
            let block = self.sent;
            self.sent = end;
            Ok(Some(block))
        })();
        self.failed |= result.is_err();
        result
    }
}

pub(in super::super) struct CreditReceiver {
    window: NonZeroU64,
    received: u64,
    consumed: u64,
    advertised: u64,
    opened: bool,
    failed: bool,
}

impl CreditReceiver {
    pub(in super::super) fn new(window: NonZeroU64) -> Self {
        Self {
            window,
            received: 0,
            consumed: 0,
            advertised: 0,
            opened: false,
            failed: false,
        }
    }

    pub(in super::super) fn open(&mut self) -> Result<u64> {
        if self.failed || self.opened {
            self.failed = true;
            anyhow::bail!("credit stream cannot reopen");
        }
        self.opened = true;
        self.advertised = self.window.get();
        Ok(self.advertised)
    }

    /// Called before reserving a new logical block's buffer. The actor must
    /// complete its existing bounded fragment assembly before delivering bytes.
    pub(in super::super) fn accept(&mut self, block: u64, bytes: usize) -> Result<()> {
        let result = (|| {
            ensure!(
                !self.failed
                    && self.opened
                    && block == self.received
                    && (1..=MAX_DATA).contains(&bytes),
                "invalid received block"
            );
            let end = self
                .received
                .checked_add(bytes as u64)
                .context("data counter overflow")?;
            ensure!(end <= self.advertised, "data exceeds advertised credit");
            self.received = end;
            Ok(())
        })();
        self.failed |= result.is_err();
        result
    }

    /// Release only bytes actually consumed by the child stdin or the caller's
    /// output reader. Capture/storage retention is a separate budget. Zero
    /// consumption sends no record; it cannot renew permission or a deadline.
    pub(in super::super) fn consumed(&mut self, bytes: u64) -> Result<Option<u64>> {
        let result = (|| {
            ensure!(!self.failed && self.opened, "credit stream denied");
            if bytes == 0 {
                return Ok(None);
            }
            let consumed = self
                .consumed
                .checked_add(bytes)
                .context("consumption overflow")?;
            ensure!(consumed <= self.received, "credit for unconsumed bytes");
            let limit = consumed
                .checked_add(self.window.get())
                .context("credit overflow")?;
            self.consumed = consumed;
            self.advertised = limit;
            Ok(Some(limit))
        })();
        self.failed |= result.is_err();
        result
    }
}

#[cfg(test)]
mod tests;
