//! Desktop launch selection through the existing configuration/store owners.
//! This does not open a database, construct a model or read credentials. Config
//! reads retain the normal publication lock and crash-recovery semantics.
use std::path::{Path, PathBuf};

use nac_core::runtime::{resolve_store_path_for_track, NacConfig, StoreOptions};
use serde::Serialize;

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Selection {
    Selected {
        version: u32,
        root_cwd: PathBuf,
        store: PathBuf,
        track: &'static str,
    },
    Failed {
        version: u32,
        code: &'static str,
        message: &'static str,
    },
}

fn failed(code: &'static str, message: &'static str) -> Selection {
    Selection::Failed {
        version: 1,
        code,
        message,
    }
}

/// Bounded nonsecret selection for the exact bundled executable's private
/// preflight. The subsequent identified engine launch revalidates its store.
pub fn configuration_json(root: &Path, store_path: Option<PathBuf>) -> anyhow::Result<String> {
    // Config publication can wait on another process. Bound this private
    // helper, including after parent loss, without signaling any other PID.
    let (finished, completion) = std::sync::mpsc::channel();
    // SAFETY: observing the parent grants no signaling or execution authority.
    let parent = unsafe { libc::getppid() };
    std::thread::Builder::new()
        .name("nac-desktop-selection".into())
        .spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                match completion.recv_timeout(std::time::Duration::from_millis(25)) {
                    Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                }
                // SAFETY: only observe parent identity, never signal it.
                if unsafe { libc::getppid() } != parent || std::time::Instant::now() >= deadline {
                    std::process::exit(70);
                }
            }
        })?;
    let selection = select(root, store_path);
    let encoded = serde_json::to_string(&selection)?;
    anyhow::ensure!(
        encoded.len() <= 16 * 1024,
        "desktop selection exceeds its bound"
    );
    let _ = finished.send(());
    Ok(encoded)
}

fn select(root: &Path, store_path: Option<PathBuf>) -> Selection {
    if std::env::var_os("NAC_MANAGED_CONFIG").is_some() {
        return failed("managed_configuration", "The local Mac app cannot launch a managed host. Remove NAC_MANAGED_CONFIG from this app's launch environment and relaunch; use the managed-host entry point for managed deployments.");
    }
    let Ok(root_cwd) = root.canonicalize() else {
        return failed("bootstrap_directory", "The bootstrap directory is unavailable. Choose an existing readable directory with --directory, then relaunch NAC.");
    };
    if !root_cwd.is_dir() {
        return failed("bootstrap_directory", "The bootstrap path is not a directory. Choose an existing directory with --directory, then relaunch NAC.");
    }
    // Both the preflight and serving child must use this same process cwd:
    // legacy relative store detection and credential owners also consult cwd.
    if std::env::current_dir().ok().as_ref() != Some(&root_cwd) {
        return failed("bootstrap_directory", "The engine bootstrap directory does not match its configuration directory. Relaunch NAC with a consistent --directory.");
    }
    let Ok(config) = NacConfig::load_without_model_from_cwd(&root_cwd) else {
        // TOML errors may quote credentials or command environment values.
        return failed("invalid_configuration", "NAC could not read its selected config.toml. Check NAC_HOME, XDG_CONFIG_HOME or HOME, repair the configuration (including any pending MCP publication), and relaunch. The selected store has not been opened.");
    };
    let store = resolve_store_path_for_track(
        &root_cwd,
        StoreOptions { store_path },
        &config,
        crate::build_identity::store_track(),
    );
    let Ok(store) = nac_core::sessions::StoreProcessLease::prepare_path(&store) else {
        return failed("store_directory", "NAC could not prepare the selected store directory. Check the configured storage.store_path or --store-path and directory access, then relaunch. The database was not opened and no alternative store was selected.");
    };
    Selection::Selected {
        version: 1,
        root_cwd,
        store,
        track: crate::build_identity::current().track,
    }
}
