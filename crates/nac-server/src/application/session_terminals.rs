use anyhow::{anyhow, Result};

use crate::SessionManager;

/// Explicit terminal lifecycle operations scoped to one persisted session.
///
/// Termination intentionally does not acquire the session operation or
/// resource mutation leases: a live terminal may itself hold those shared
/// leases, and this operation exists to settle that exact ownership. The
/// lifecycle gate still orders attachment against deletion and configuration
/// replacement.
pub(crate) struct SessionTerminalApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionTerminalApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn terminate(&self, session_id: &str, terminal_id: &str) -> Result<()> {
        const MAX_TERMINAL_ID_BYTES: usize = 1024;
        if terminal_id.is_empty() || terminal_id.len() > MAX_TERMINAL_ID_BYTES {
            return Err(anyhow!("terminal_id is invalid"));
        }
        self.manager
            .require_persisted_operation_session(session_id)?;
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.manager
            .require_persisted_operation_session(session_id)?;
        let service = self.manager.attach_session_locked(session_id, None).await?;
        service.terminate_terminal(terminal_id).await
    }
}

impl SessionManager {
    pub async fn terminate_terminal(&self, session_id: &str, terminal_id: &str) -> Result<()> {
        self.session_terminals()
            .terminate(session_id, terminal_id)
            .await
    }
}
