use std::path::Path;
use anyhow::{anyhow, Result};
use tokio::process::Command;

pub async fn check_available() -> Result<()> {
    let output = Command::new("podman").arg("--version").output().await
        .map_err(|_| anyhow!("podman not found — install podman to use nacserver"))?;
    if !output.status.success() {
        return Err(anyhow!("podman not working: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

pub struct RunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub async fn run_ephemeral(
    container_name: &str,
    image: &str,
    workspace: &Path,
    env_vars: &[(&str, &str)],
    prompt: &str,
) -> Result<RunResult> {
    let mut args = vec![
        "run".to_string(), "--rm".to_string(),
        "--name".to_string(), container_name.to_string(),
        "-v".to_string(), format!("{}:/workspace", workspace.display()),
        "-w".to_string(), "/workspace".to_string(),
    ];
    for (k, v) in env_vars {
        args.push("-e".to_string());
        args.push(format!("{}={}", k, v));
    }
    args.push(image.to_string());
    args.push("nac".to_string());
    args.push("--orchestrator".to_string());
    args.push("--single".to_string());
    args.push(prompt.to_string());

    let output = Command::new("podman")
        .args(&args)
        .output()
        .await
        .map_err(|e| anyhow!("podman run failed: {}", e))?;

    Ok(RunResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}

pub async fn kill_container(container_name: &str) -> Result<()> {
    let _ = Command::new("podman")
        .args(["kill", container_name])
        .output()
        .await;
    Ok(())
}
