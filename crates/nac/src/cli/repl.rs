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

pub(super) async fn commit_managed_worker(
    worker: &ManagedWorkerConfig,
    response: &str,
) -> Result<()> {
    let path = worker.store_path.clone();
    let sid = worker.session_id.clone();
    let thread = worker.thread_name.clone();
    let action = worker.action.clone();
    let response = response.to_string();
    tokio::task::spawn_blocking(move || {
        store::append_episode(&path, &sid, &thread, &action, &response)
    })
    .await??;
    Ok(())
}

pub(super) async fn persist_session_snapshot(
    snapshot: &mut SessionSnapshot,
    agent: &Agent,
) -> Result<()> {
    let refreshed = sessions::refresh_snapshot(snapshot, agent.messages.clone());
    let snapshot_for_blocking = refreshed.clone();
    tokio::task::spawn_blocking(move || sessions::save_session(&snapshot_for_blocking)).await??;
    *snapshot = refreshed;
    Ok(())
}

pub(super) async fn run_non_tui(run_config: RunConfig) -> Result<()> {
    let mut session_snapshot = run_config.session_snapshot.clone();
    let mut agent = run_config.agent;

    if let Some(prompt) = run_config.initial_prompt {
        let send_result = agent.send(&prompt).await;
        if let Some(snapshot) = session_snapshot.as_mut() {
            persist_session_snapshot(snapshot, &agent).await?;
        }
        let response = send_result?;
        if let Some(worker) = &run_config.managed_worker {
            commit_managed_worker(worker, &response).await?;
        }
        println!("{}", response);
        if !run_config.continue_repl {
            return Ok(());
        }
    }

    let stdin = io::stdin();
    loop {
        eprint!("\n> ");
        io::stderr().flush()?;

        let mut line = String::new();
        let bytes = stdin.read_line(&mut line)?;
        if bytes == 0 {
            break;
        }

        let input = line.trim();
        if input.is_empty() {
            continue;
        }
        if input == "/exit" {
            break;
        }

        let send_result = agent.send(input).await;
        if let Some(snapshot) = session_snapshot.as_mut() {
            persist_session_snapshot(snapshot, &agent).await?;
        }

        match send_result {
            Ok(response) => println!("{}", response),
            Err(error) => eprintln!("Error: {}", error),
        }
    }

    Ok(())
}
