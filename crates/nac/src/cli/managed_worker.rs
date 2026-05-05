use super::*;

pub(super) fn build_worker_context_messages(
    thread_name: &str,
    worker_context: &WorkerContext,
) -> Vec<Message> {
    let mut messages = Vec::new();
    if let Some(self_context) =
        store::render_self_context(thread_name, &worker_context.self_episodes)
    {
        messages.push(Message::User {
            content: self_context,
        });
    }
    for source_episode in &worker_context.source_episodes {
        messages.push(Message::User {
            content: store::render_source_context(source_episode),
        });
    }
    messages
}

pub(super) async fn commit_managed_worker_episode(
    store_path: PathBuf,
    session_id: String,
    thread_name: String,
    action: String,
    response: &str,
) -> Result<()> {
    let response = response.to_string();
    tokio::task::spawn_blocking(move || {
        store::append_episode(&store_path, &session_id, &thread_name, &action, &response)
    })
    .await??;
    Ok(())
}

pub(super) async fn run_managed_worker(run_config: ManagedWorkerRunConfig) -> Result<()> {
    let ManagedWorkerRunConfig {
        mut agent,
        store_path,
        session_id,
        thread_name,
        action,
    } = run_config;

    let send_result = agent.send(&action).await;
    let response = send_result?;
    commit_managed_worker_episode(store_path, session_id, thread_name, action, &response).await?;
    println!("{}", response);
    Ok(())
}
