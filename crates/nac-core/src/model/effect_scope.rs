//! Model-call adapter for the inward runtime lease. It never changes host keys.
use crate::{
    run_failure::{PartialModelOutput, RecoveryAction, RunFailure, RunFailureKind},
    runtime::RuntimeEffectLeaseHandle,
};
use anyhow::Result;
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc,
    },
};

const DENIED: &str = "managed runtime effect lease denied";

#[derive(Clone, Default)]
pub(super) struct CallEffectScope {
    lease: Option<RuntimeEffectLeaseHandle>,
    denied: Arc<AtomicBool>,
    partial: Arc<AtomicU8>,
}

impl CallEffectScope {
    pub(super) fn new(required: bool, lease: Option<RuntimeEffectLeaseHandle>) -> Result<Self> {
        let scope = Self {
            lease,
            denied: Arc::new(AtomicBool::new(false)),
            partial: Arc::new(AtomicU8::new(0)),
        };
        if required && scope.lease.is_none() {
            return scope.deny();
        }
        scope.check_available()?;
        Ok(scope)
    }

    pub(super) fn is_leased(&self) -> bool {
        self.lease.is_some()
    }

    fn deny<T>(&self) -> Result<T> {
        self.denied.store(true, Ordering::Release);
        let bits = self.partial.load(Ordering::Acquire);
        let mut failure = RunFailure::unknown(DENIED);
        failure.kind = RunFailureKind::Validation;
        failure.recovery_action = RecoveryAction::None;
        failure.partial_output = PartialModelOutput {
            text: bits & 1 != 0,
            reasoning: bits & 2 != 0,
            tool_call: bits & 4 != 0,
        };
        Err(failure.into())
    }

    pub(super) fn record_partial(&self, partial: PartialModelOutput) {
        let bits = u8::from(partial.text)
            | (u8::from(partial.reasoning) << 1)
            | (u8::from(partial.tool_call) << 2);
        self.partial.fetch_or(bits, Ordering::AcqRel);
    }

    pub(super) fn check_available(&self) -> Result<()> {
        if self.denied.load(Ordering::Acquire) {
            return self.deny();
        }
        if self
            .lease
            .as_ref()
            .is_some_and(|lease| lease.check_available().is_err())
        {
            return self.deny();
        }
        Ok(())
    }

    pub(super) async fn check_current(&self) -> Result<()> {
        self.check_available()?;
        if let Some(lease) = &self.lease {
            if lease.check_current().await.is_err() {
                return self.deny();
            }
        }
        self.check_available()
    }

    pub(super) async fn run<T>(&self, future: impl Future<Output = Result<T>>) -> Result<T> {
        let Some(lease) = &self.lease else {
            return future.await;
        };
        tokio::select! {
            biased;
            _ = lease.wait_for_denial() => self.deny(),
            result = async {
                self.check_current().await?;
                let value = future.await;
                self.check_current().await?;
                value
            } => result,
        }
    }
}
