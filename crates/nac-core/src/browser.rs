//! Open a URL or local path with the platform default handler.

use std::io::IsTerminal;
use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};

/// Whether an interactive CLI should open a browser by default.
///
/// Skips when stdin is not a TTY or `BROWSER=none` (same convention as
/// create-react-app / Vite).
pub fn should_open_browser() -> bool {
    if std::env::var_os("BROWSER").is_some_and(|value| value == "none") {
        return false;
    }
    std::io::stdin().is_terminal()
}

/// Best-effort open of `url` in the platform default browser.
pub fn open_url(url: &str) {
    let result = {
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(url).spawn()
        }
        #[cfg(target_os = "windows")]
        {
            // `start` needs an empty window-title argument before the URL.
            // Pass the whole line as one `/c` string so `&` in query strings is
            // not treated as a cmd separator — `Command` only quotes args that
            // contain whitespace, so a bare URL arg gets truncated.
            let command = format!("start \"\" \"{}\"", url.replace('"', ""));
            Command::new("cmd").args(["/c", &command]).spawn()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Command::new("xdg-open").arg(url).spawn()
        }
    };
    if let Err(error) = result {
        eprintln!("could not open the browser ({error}); visit {url} manually");
    }
}

/// Open a local file or directory with the platform default handler.
///
/// A missing file opens its parent directory instead when that parent exists,
/// so a chat link to something the agent has not written yet still lands the
/// user somewhere useful.
pub fn open_path(path: &Path) -> Result<()> {
    let target = if path.exists() {
        path.to_path_buf()
    } else {
        let parent = path
            .parent()
            .filter(|parent| parent.exists())
            .ok_or_else(|| anyhow::anyhow!("path '{}' does not exist", path.display()))?;
        parent.to_path_buf()
    };

    spawn_open(&target).with_context(|| format!("failed to open '{}'", target.display()))?;
    Ok(())
}

fn spawn_open(path: &Path) -> Result<()> {
    let result = {
        #[cfg(target_os = "macos")]
        {
            Command::new("open").arg(path).spawn()
        }
        #[cfg(target_os = "windows")]
        {
            let display = path.to_string_lossy().replace('"', "");
            let command = if path.is_dir() {
                format!("explorer \"{display}\"")
            } else {
                format!("start \"\" \"{display}\"")
            };
            Command::new("cmd").args(["/c", &command]).spawn()
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Command::new("xdg-open").arg(path).spawn()
        }
    };
    match result {
        Ok(_) => Ok(()),
        Err(error) => bail!("{error}"),
    }
}

/// Reveal an already validated existing target in Finder without opening the
/// file's registered application, a shell, a URL, or a missing parent.
pub(crate) async fn reveal_path(path: &Path) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::{process::Stdio, time::Duration};
        let mut command = tokio::process::Command::new("/usr/bin/open");
        command
            .arg("-R")
            .arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let (mut child, mut tree) = nac_process::ProcessTreeGuard::spawn_supervised(&mut command)
            .context("could not reveal workspace path in Finder")?;
        let status = match tokio::time::timeout(Duration::from_secs(5), child.wait()).await {
            Ok(Ok(status)) => {
                tree.mark_leader_reaped();
                tree.finish_checked().await?;
                status
            }
            result => {
                tree.terminate(&mut child)
                    .await
                    .context("Finder reveal process cleanup failed")?;
                return match result {
                    Ok(Err(error)) => Err(error).context("Finder reveal process failed"),
                    _ => Err(anyhow::anyhow!(
                        "Finder reveal timed out; no automatic retry"
                    )),
                };
            }
        };
        if !status.success() {
            bail!("Finder rejected the workspace reveal");
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        bail!("workspace Finder reveal is only supported on macOS")
    }
}
