//! Model observation authority is narrower than browser inventory. It binds
//! the attached direct manager and current session without recovering work.
use super::*;

impl TerminalManager {
    pub(crate) fn model_observation_resource(
        &self,
        store_path: &std::path::Path,
        session_id: Option<&str>,
    ) -> Result<String> {
        let authority = self
            .session_resource_authority
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !self.preserve_retained_on_settlement
            || !authority.as_ref().is_some_and(|(store, session)| {
                store == store_path && Some(session.as_str()) == session_id
            })
        {
            return Err(anyhow!("execution unavailable"));
        }
        Ok(format!("execution-catalog-{}", self.instance_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn model_stream_resolution_reports_retention_gaps_without_lifetime_or_cursor_effects() {
        let mut manager = TerminalManager::for_direct();
        manager.output_registry = OutputRegistry::new(CommandOutputLimits {
            per_command_bytes: 8,
            per_session_bytes: 16,
        })
        .unwrap();
        manager.configure_session_resource_authority(PathBuf::from("store"), "session".into());
        let backend = Arc::new(ExecutionBackend::Local {
            workspace_cwd: std::env::current_dir().unwrap(),
        });
        let output = manager
            .exec_one_shot(
                "printf 0123456789abcdef",
                None,
                80,
                24,
                1000,
                16,
                &backend,
                None,
            )
            .await;
        assert_eq!(output.exit_code, Some(0));
        assert!(manager
            .model_observation_resource(std::path::Path::new("store"), Some("session"))
            .is_ok());
        let entry = manager.execution_catalog().await.pop().unwrap();
        let page = manager
            .read_execution_stream_output(&entry.id, OutputStream::Combined, 0, 8)
            .await
            .unwrap();
        assert!(page.gap && page.bytes.is_empty());
        assert_eq!(page.next_offset, 8);
        let tail = manager
            .read_execution_stream_output(&entry.id, OutputStream::Combined, page.next_offset, 8)
            .await
            .unwrap();
        assert_eq!(tail.bytes, b"89abcdef");
        assert!(tail.caught_up && !tail.gap);
        assert!(manager
            .read_execution_stream_output(
                output.output_id.as_deref().unwrap(),
                OutputStream::Combined,
                8,
                8
            )
            .await
            .is_err());
        assert!(manager
            .model_observation_resource(std::path::Path::new("store"), Some("fork"))
            .is_err());
        assert!(!manager.execution_status(&entry.id).await.unwrap().alive);
        manager.remove_all().await.unwrap();
    }
}
