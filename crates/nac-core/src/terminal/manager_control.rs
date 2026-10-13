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
        if result.outcome == super::super::InputDeliveryOutcome::Unconfirmed {
            control.freeze();
        }
        Ok(result)
    }
}

#[cfg(test)]
#[path = "manager_control_tests.rs"]
mod tests;
