use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{anyhow, Context, Result};

const DEFAULT_REPO: &str = "sapiosaturn/nac";
const DEFAULT_BRANCH: &str = "main";
const RAW_GITHUB_BASE: &str = "https://raw.githubusercontent.com";

#[derive(Debug, Clone)]
pub struct UpgradeRequest {
    pub install_dir: Option<PathBuf>,
    pub executable_path: Option<PathBuf>,
    pub package_version: String,
}

pub async fn run_upgrade(request: UpgradeRequest) -> Result<()> {
    let install_dir = upgrade_install_dir(request.install_dir, request.executable_path.as_deref())?;
    let uninstall_url = script_url("uninstall.sh");
    let install_url = script_url("install.sh");
    let client = reqwest::Client::new();

    println!("upgrading nac in {}", install_dir.display());
    println!("downloading {uninstall_url}");
    let uninstall_script =
        download_script(&client, &uninstall_url, &request.package_version).await?;
    println!("downloading {install_url}");
    let install_script = download_script(&client, &install_url, &request.package_version).await?;

    ensure_installer_downloader_available()?;
    run_script("uninstall.sh", &uninstall_script, &install_dir)?;
    run_script("install.sh", &install_script, &install_dir)?;

    Ok(())
}

fn upgrade_install_dir(
    override_dir: Option<PathBuf>,
    executable_path: Option<&Path>,
) -> Result<PathBuf> {
    if let Some(dir) = override_dir {
        return Ok(dir);
    }
    if let Some(dir) = std::env::var_os("INSTALL_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let executable_path = executable_path.ok_or_else(|| {
        anyhow!("nac executable path was not provided and install dir was not configured")
    })?;
    executable_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| anyhow!("nac executable does not have a parent directory"))
}

fn script_url(script: &str) -> String {
    if let Ok(base_url) = std::env::var("NAC_SCRIPT_BASE_URL") {
        return format!("{}/{}", base_url.trim_end_matches('/'), script);
    }
    let repo = std::env::var("NAC_REPO").unwrap_or_else(|_| DEFAULT_REPO.to_string());
    let branch = std::env::var("NAC_SCRIPT_BRANCH").unwrap_or_else(|_| DEFAULT_BRANCH.to_string());
    format!(
        "{}/{}/{}/scripts/{}",
        RAW_GITHUB_BASE,
        repo.trim_matches('/'),
        branch.trim_matches('/'),
        script
    )
}

async fn download_script(
    client: &reqwest::Client,
    url: &str,
    package_version: &str,
) -> Result<String> {
    let response = client
        .get(url)
        .header("User-Agent", format!("nac/{package_version}"))
        .send()
        .await
        .with_context(|| format!("failed to download {url}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .with_context(|| format!("failed to read {url}"))?;
    if !status.is_success() {
        return Err(anyhow!(
            "failed to download {}: HTTP {}: {}",
            url,
            status.as_u16(),
            body.chars().take(500).collect::<String>()
        ));
    }
    Ok(body)
}

fn run_script(name: &str, script: &str, install_dir: &Path) -> Result<()> {
    println!("running {name}");
    let mut child = Command::new("sh")
        .arg("-s")
        .env("INSTALL_DIR", install_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .with_context(|| format!("failed to start {name}"))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow!("failed to open stdin for {name}"))?;
        stdin
            .write_all(script.as_bytes())
            .with_context(|| format!("failed to write {name} to shell"))?;
    }

    let status = child
        .wait()
        .with_context(|| format!("failed to wait for {name}"))?;
    if !status.success() {
        return Err(anyhow!("{name} failed with status {status}"));
    }
    Ok(())
}

fn ensure_installer_downloader_available() -> Result<()> {
    if command_exists("curl") || command_exists("wget") {
        return Ok(());
    }
    Err(anyhow!(
        "nac upgrade needs curl or wget because scripts/install.sh uses one to fetch the release archive"
    ))
}

fn command_exists(name: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg("command -v \"$1\" >/dev/null 2>&1")
        .arg("sh")
        .arg(name)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;
    use std::ffi::OsString;

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    #[test]
    fn script_url_uses_defaults_and_env_overrides() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_repo = std::env::var_os("NAC_REPO");
        let original_branch = std::env::var_os("NAC_SCRIPT_BRANCH");
        let original_base = std::env::var_os("NAC_SCRIPT_BASE_URL");
        unsafe {
            std::env::remove_var("NAC_REPO");
            std::env::remove_var("NAC_SCRIPT_BRANCH");
            std::env::remove_var("NAC_SCRIPT_BASE_URL");
        }

        assert_eq!(
            script_url("install.sh"),
            "https://raw.githubusercontent.com/sapiosaturn/nac/main/scripts/install.sh"
        );

        unsafe {
            std::env::set_var("NAC_REPO", "owner/repo");
            std::env::set_var("NAC_SCRIPT_BRANCH", "dev");
        }
        assert_eq!(
            script_url("uninstall.sh"),
            "https://raw.githubusercontent.com/owner/repo/dev/scripts/uninstall.sh"
        );

        unsafe {
            std::env::set_var("NAC_SCRIPT_BASE_URL", "https://example.com/scripts/");
        }
        assert_eq!(
            script_url("install.sh"),
            "https://example.com/scripts/install.sh"
        );

        restore_env("NAC_REPO", original_repo);
        restore_env("NAC_SCRIPT_BRANCH", original_branch);
        restore_env("NAC_SCRIPT_BASE_URL", original_base);
    }
}
