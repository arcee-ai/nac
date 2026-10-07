//! Deterministic inward-lease fixture; no authority, provider or transport wire.
use crate::runtime::RuntimeEffectLease;
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
use tokio::sync::watch;

pub(super) struct ControlledLease {
    denied: watch::Sender<bool>,
    checks: AtomicUsize,
    deny_at: usize,
}
impl ControlledLease {
    pub(super) fn new(deny_at: usize) -> Arc<Self> {
        let (denied, _) = watch::channel(false);
        Arc::new(Self {
            denied,
            checks: AtomicUsize::new(0),
            deny_at,
        })
    }
    pub(super) fn deny(&self) {
        self.denied.send_replace(true);
    }
}
impl RuntimeEffectLease for ControlledLease {
    fn check_available(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            !*self.denied.borrow(),
            "private-operation-capability-canary"
        );
        Ok(())
    }
    fn check_current(&self) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + '_>> {
        Box::pin(async move {
            if self.checks.fetch_add(1, Ordering::SeqCst) + 1 == self.deny_at {
                self.deny();
            }
            self.check_available()
        })
    }
    fn wait_for_denial(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let mut denied = self.denied.subscribe();
            let _ = denied.wait_for(|value| *value).await;
        })
    }
}
