//! Portable PTY adaptation and lifetime leases for the inward native owner.
//! Process inspection and identity-safe cleanup belong entirely to nac-process.

use std::io;
use std::sync::{Arc, Mutex};

use nac_process::{NativePtyChild, NativePtyOwner};

use crate::sessions::{SessionResourceLease, WorkspaceActivityLease};

#[derive(Clone, Default)]
pub(super) struct NativeLifetime(Arc<Mutex<LifetimeLeases>>);

#[derive(Default)]
struct LifetimeLeases {
    workspace: Option<WorkspaceActivityLease>,
    session: Option<SessionResourceLease>,
}

impl NativeLifetime {
    pub(super) fn retain(
        &self,
        workspace: Option<WorkspaceActivityLease>,
        session: Option<SessionResourceLease>,
    ) {
        let mut leases = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if workspace.is_some() {
            leases.workspace = workspace;
        }
        if session.is_some() {
            leases.session = session;
        }
    }
}

struct PortableChild {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    // The infrastructure worker retains these leases even if the terminal and
    // its manager are dropped while cleanup is incomplete.
    _lifetime: NativeLifetime,
}

impl NativePtyChild for PortableChild {
    fn process_id(&self) -> Option<u32> {
        self.child.process_id()
    }

    fn try_wait(&mut self) -> io::Result<Option<i32>> {
        self.child
            .try_wait()
            .map(|status| status.map(|status| status.exit_code() as i32))
    }
}

pub(super) fn transfer(
    child: Box<dyn portable_pty::Child + Send + Sync>,
    notify: Arc<tokio::sync::Notify>,
    lifetime: NativeLifetime,
) -> NativePtyOwner {
    NativePtyOwner::from_fresh_session(
        Box::new(PortableChild {
            child,
            _lifetime: lifetime,
        }),
        Arc::new(move || {
            notify.notify_waiters();
            // Retain one permit for a status-only change that lands between
            // an empty page and registration of its next bounded output wait.
            notify.notify_one();
        }),
    )
}
