use super::*;

impl Agent {
    /// Called after the complete tool-result batch commits. A durable question
    /// yields this run before another provider call, without changing its goal.
    pub(super) async fn yield_for_question(
        &mut self,
        usage: &TokenUsage,
    ) -> Result<Option<String>> {
        let Some(baseline) = self
            .tool_runtime
            .goal_runtime
            .as_ref()
            .and_then(|g| g.current_baseline())
        else {
            return Ok(None);
        };
        let Some(session) = self.tool_runtime.session_id.clone() else {
            return Ok(None);
        };
        let path = self.tool_runtime.store_path.clone();
        let question = crate::store::spawn_blocking_store_caller(move || {
            let records = crate::store::list_task_questions(&path, &session)?;
            Ok::<_, anyhow::Error>(records.into_iter().find(|q| {
                q.request.run_id == baseline.run_id
                    && (q.status == "pending" || q.continuation_state.as_deref() == Some("pending"))
            }))
        })
        .await??;
        let Some(question) = question else {
            return Ok(None);
        };
        let content = format!("Waiting for an answer: {}", question.request.text);
        self.push_and_log(Message::Assistant {
            content: Some(content.clone()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        })
        .await?;
        self.tool_runtime.terminal_manager.settle_run().await?;
        self.emit(AgentEvent::AssistantMessage {
            thread_name: self.thread_name.clone(),
            content: content.clone(),
            usage: Some(usage.clone()),
        })
        .await;
        self.emit(AgentEvent::RunFinished {
            thread_name: self.thread_name.clone(),
        })
        .await;
        Ok(Some(content))
    }
}
