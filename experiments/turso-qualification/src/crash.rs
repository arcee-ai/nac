use crate::engine::Backend;
use anyhow::{ensure, Context, Result};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Command, Stdio};

pub async fn child(mode: &str, path: &Path, id: &str) -> Result<()> {
    let backend = Backend::open(mode, path).await?;
    let conn = backend.connect()?;
    let begin = if mode == "mvcc" {
        "BEGIN CONCURRENT"
    } else {
        "BEGIN IMMEDIATE"
    };
    conn.execute(begin).await?;
    conn.execute(&format!(
        "UPDATE sessions SET config_version=config_version+1 WHERE session_id='{id}'"
    ))
    .await?;
    conn.execute("COMMIT").await?;
    conn.execute(begin).await?;
    conn.execute(&format!(
        "UPDATE sessions SET config_version=config_version+100 WHERE session_id='{id}'"
    ))
    .await?;
    println!("READY");
    std::io::stdout().flush()?;
    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    anyhow::bail!("crash child must be killed at the synchronized uncommitted boundary")
}

pub async fn probe(mode: &str, path: &Path, id: &str, previous: i64) -> Result<Value> {
    let mut child = Command::new(std::env::current_exe()?)
        .args(["crash-child", mode, path.to_str().unwrap(), id])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let stdout = child.stdout.take().context("child stdout")?;
    let (send, receive) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut line = String::new();
        let outcome = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = send.send(outcome);
    });
    let ready = receive.recv_timeout(std::time::Duration::from_secs(15));
    // Every branch reaps this exact child; no other process is signalled.
    let _ = child.kill();
    let status = child.wait()?;
    reader
        .join()
        .map_err(|_| anyhow::anyhow!("crash barrier reader panic"))?;
    ensure!(
        ready.context("crash child barrier timed out")??.trim() == "READY",
        "crash child did not reach uncommitted boundary"
    );
    let backend = Backend::open(mode, path).await?;
    let conn = backend.connect()?;
    let after = conn
        .scalar(&format!(
            "SELECT config_version FROM sessions WHERE session_id='{id}'"
        ))
        .await?;
    ensure!(
        after == previous + 1,
        "committed mutation lost or uncommitted mutation survived"
    );
    // A retry of an already committed expected-revision mutation must do nothing.
    ensure!(conn.execute(&format!("UPDATE sessions SET config_version=config_version+1 WHERE session_id='{id}' AND config_version={previous}")).await?==0,"retry duplicated mutation");
    Ok(
        json!({"child_status":status.to_string(),"before":previous,"after":after,"committed_survived":true,"uncommitted_absent":true,"retry_rejected":true}),
    )
}
