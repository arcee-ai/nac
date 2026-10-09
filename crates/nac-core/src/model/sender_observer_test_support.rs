//! Synthetic observation only: no enrollment, key custody, issuer or transport.
use super::{ManagedHostExecutionObserver, ManagedHostKeyBinding};
use anyhow::{ensure, Result};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

pub(crate) struct SyntheticSenderObserver {
    pub binding: ManagedHostKeyBinding,
    pub calls: AtomicUsize,
    state: Mutex<(bool, [u8; 32])>,
}

impl SyntheticSenderObserver {
    pub fn new() -> Self {
        Self {
            binding: ManagedHostKeyBinding {
                bootstrap_id: "082b0d65-c18e-42e1-88f3-62f98832f4d3".into(),
                managed_host_id: "3508b3e4-bc67-49a4-a838-9a3a47a96527".into(),
                host_incarnation_id: "synthetic-observer-incarnation".into(),
                pvc_uid: "synthetic-observer-pvc".into(),
                organization_id: "ad6ed47a-6c6d-4200-bf73-0466c8ddf917".into(),
                owner_epoch: 3,
                key_generation: 7,
                local_key_id: "7685f191-df70-4962-bdc8-5a8a8c5e4cef".into(),
                key_id: "synthetic-observer-key".into(),
                clerk_instance_id: "synthetic-observer-clerk".into(),
                inference_origin: "https://api.arcee.ai".into(),
            },
            calls: AtomicUsize::new(0),
            state: Mutex::new((true, [7; 32])),
        }
    }

    pub fn set_current(&self, current: bool) {
        self.state.lock().unwrap().0 = current;
    }

    pub fn set_revision(&self, revision: [u8; 32]) {
        self.state.lock().unwrap().1 = revision;
    }
}

impl ManagedHostExecutionObserver for SyntheticSenderObserver {
    fn observe(&self, expected: &ManagedHostKeyBinding) -> Result<[u8; 32]> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        ensure!(
            expected == &self.binding,
            "synthetic sender binding mismatch"
        );
        let state = self.state.lock().unwrap();
        ensure!(state.0, "synthetic-private-observer-error-canary");
        Ok(state.1)
    }
}
