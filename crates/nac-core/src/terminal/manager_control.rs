//! Controller admission shares existing session incarnation and lifetime.
use super::super::{InputControlStatus, InputController, InputTicket};
use super::*;

impl TerminalManager {
    /// Synchronous native preparation fails before policy if the process map
    /// is busy. No approval can later capture a newer controller implicitly.
    pub(crate) fn prepare_model_input(&self, name: &str) -> Result<InputTicket> {
        let mut sessions = self
            .sessions
            .try_lock()
            .map_err(|_| anyhow!("terminal input owner is busy; retry preparation"))?;
        let session = sessions
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?;
        session.refresh_status();
        if !session.accepts_user_input() {
            return Err(anyhow!("terminal has exited"));
        }
        if session.is_user_owned() && !self.shared_input_eligible(session) {
            return Err(anyhow!("terminal is unavailable to model input"));
        }
        session
            .input_control()
            .ticket(session.output_id(), InputController::Agent)
    }

    /// Read-only composition port for model inventory. It neither refreshes
    /// process state nor acquires an input ticket, retention, or policy grant.
    #[allow(
        dead_code,
        reason = "ALL-299 inventory consumes this controller port in the coordinator-owned composition"
    )]
    pub(crate) fn execution_model_input_state(&self, name: &str) -> Option<InputControlStatus> {
        let sessions = self.sessions.try_lock().ok()?;
        let session = sessions.get(name)?;
        if !session.accepts_user_input()
            || (session.is_user_owned() && !self.shared_input_eligible(session))
        {
            return None;
        }
        Some(session.input_control().status())
    }

    pub(crate) fn revalidate_model_input(&self, name: &str, expected: &InputTicket) -> Result<()> {
        let current = self.prepare_model_input(name)?;
        if current != *expected {
            return Err(anyhow!(
                "terminal controller changed while awaiting authorization; input was not sent"
            ));
        }
        Ok(())
    }

    fn shared_input_eligible(&self, session: &TerminalSession) -> bool {
        self.preserve_retained_on_settlement
            && session.backend_label == "local"
            && (session.is_user_owned() || session.is_retained())
            && session.accepts_user_input()
    }

    pub(crate) async fn input_control_status(&self, name: &str) -> Result<InputControlStatus> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?;
        session.refresh_status();
        if !self.shared_input_eligible(session) {
            return Err(anyhow!("execution is read-only"));
        }
        Ok(session.input_control().status())
    }

    pub(crate) async fn transfer_input_control(
        &self,
        name: &str,
        expected: u64,
        target: InputController,
        acknowledge: bool,
    ) -> Result<InputControlStatus> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?;
        session.refresh_status();
        if !self.shared_input_eligible(session) {
            return Err(anyhow!("execution is read-only"));
        }
        session
            .input_control()
            .transfer(expected, target, acknowledge)
    }

    pub(crate) async fn write_controlled_human_input(
        &self,
        name: &str,
        expected: u64,
        bytes: &[u8],
        cancellation: &ThreadCancellation,
    ) -> Result<()> {
        self.write_controlled_human_input_receipt(name, expected, bytes, cancellation)
            .await?
            .into_result()
    }

    pub(crate) async fn write_controlled_human_input_receipt(
        &self,
        name: &str,
        expected: u64,
        bytes: &[u8],
        cancellation: &ThreadCancellation,
    ) -> Result<super::super::InputDeliveryReceipt> {
        self.write_human_input_receipt(name, expected, bytes, cancellation, true)
            .await
    }

    pub(super) async fn write_initial_human_input(
        &self,
        name: &str,
        bytes: &[u8],
        cancellation: &ThreadCancellation,
    ) -> Result<()> {
        // The original protocol has browser-owned explicit recovery and no
        // server acknowledgement route. Preserve that initial-only contract;
        // shared revisions use the fenced server recovery endpoint instead.
        self.write_human_input_receipt(name, 1, bytes, cancellation, false)
            .await?
            .into_result()
    }

    async fn write_human_input_receipt(
        &self,
        name: &str,
        expected: u64,
        bytes: &[u8],
        cancellation: &ThreadCancellation,
        freeze_on_unconfirmed: bool,
    ) -> Result<super::super::InputDeliveryReceipt> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(name)
            .ok_or_else(|| self.missing_session_error(name))?;
        session.refresh_status();
        if !self.shared_input_eligible(session) {
            return Err(anyhow!("execution is read-only"));
        }
        let ticket = session
            .input_control()
            .ticket(session.output_id(), InputController::Human)?;
        if ticket.revision != expected {
            return Err(anyhow!(
                "terminal controller revision changed; input was not accepted"
            ));
        }
        let control = session.input_control().clone();
        let receipt = session.enqueue_input(bytes, ticket, cancellation)?;
        drop(sessions);
        let result = super::super::input::await_delivery(receipt).await;
        if freeze_on_unconfirmed
            && result.outcome == super::super::InputDeliveryOutcome::Unconfirmed
        {
            control.freeze();
        }
        Ok(result)
    }
}

#[cfg(test)]
#[path = "manager_control_tests.rs"]
mod tests;
