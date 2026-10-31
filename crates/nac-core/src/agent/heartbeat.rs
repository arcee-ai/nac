//! Person-input provenance for native scheduling, never inferred from model
//! text, automation envelopes, skill contents or the latest durable goal.
use super::*;

impl Agent {
    pub(crate) fn bind_heartbeat_execution(
        &mut self,
        occurrence: Option<&crate::store::HeartbeatOccurrence>,
    ) {
        self.tool_runtime.heartbeat_execution = occurrence.is_some();
        self.tool_runtime.heartbeat_goal_id = occurrence.and_then(|o| o.spec.goal_id.clone());
    }
    pub(super) async fn capture_heartbeat_request(
        &mut self,
        inbox_id: Option<i64>,
        person_input: Option<&str>,
    ) {
        self.tool_runtime
            .heartbeat_needs_human_action
            .store(false, std::sync::atomic::Ordering::Release);
        self.tool_runtime.heartbeat_human_request = person_input.map(str::to_owned);
        if person_input.is_some() {
            return;
        }
        let (Some(inbox), Some(session)) = (inbox_id, self.tool_runtime.session_id.clone()) else {
            return;
        };
        let path = self.tool_runtime.store_path.clone();
        self.tool_runtime.heartbeat_human_request =
            crate::store::spawn_blocking_store_caller(move || {
                crate::store::heartbeat_person_inbox_request(&path, &session, inbox)
            })
            .await
            .ok()
            .and_then(Result::ok)
            .flatten();
    }

    /// A new committed person steer can authorize a scheduling operation in an
    /// executing turn. Automation steers cannot manufacture that provenance.
    pub(super) async fn refresh_heartbeat_request_from_guidance(&mut self) {
        let (Some(session), Some(run)) = (
            self.tool_runtime.session_id.clone(),
            self.tool_runtime.active_threads.run_id(),
        ) else {
            return;
        };
        let path = self.tool_runtime.store_path.clone();
        match crate::store::spawn_blocking_store_caller(move || {
            crate::store::heartbeat_person_run_request(&path, &session, &run)
        })
        .await
        {
            Ok(Ok(Some(request))) => self.tool_runtime.heartbeat_human_request = Some(request),
            Ok(Ok(None)) => {}
            _ => self.tool_runtime.heartbeat_human_request = None,
        }
    }
}
