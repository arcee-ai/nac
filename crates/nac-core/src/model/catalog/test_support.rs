//! Shared test scaffolding for the catalog test modules: temp homes, the
//! overlay-file writer, and the env-mutating guard that restores
//! everything on drop.

use super::*;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn fresh_home(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let home = std::env::temp_dir().join(format!(
        "nac-catalog-test-{label}-{}-{unique}",
        std::process::id()
    ));
    std::fs::create_dir_all(&home).unwrap();
    home
}

/// Temp home for layered-load tests that never touch the environment or
/// the process-global catalog.
pub(super) struct TempHome(PathBuf);

impl TempHome {
    pub(super) fn new(label: &str) -> Self {
        Self(fresh_home(label))
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Write a `$NAC_HOME/model-catalog/overlay.json` doc.
pub(super) fn write_overlay(home: &Path, generated_at: &str, providers: serde_json::Value) {
    let dir = overlay::overlay_dir(home);
    std::fs::create_dir_all(&dir).unwrap();
    let doc = serde_json::json!({ "generated_at": generated_at, "providers": providers });
    std::fs::write(
        dir.join("overlay.json"),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();
}

/// Env-mutating test guard: saves the `saved` variables, points NAC_HOME
/// at a fresh temp home, and removes the `cleared` ones. On drop it
/// restores the variables, removes the home, disables the machine-state
/// layers, reloads the baseline-only global catalog, and resets the
/// refresh once-guard — panic-safe, so concurrent tests never observe
/// each other's state. Pair with `TEST_ENV_LOCK`.
pub(super) struct EnvGuard {
    original: Vec<(&'static str, Option<OsString>)>,
    home: PathBuf,
}

impl EnvGuard {
    pub(super) fn new(label: &str, saved: &[&'static str], cleared: &[&'static str]) -> Self {
        let home = fresh_home(label);
        let original = saved
            .iter()
            .map(|name| (*name, std::env::var_os(name)))
            .collect::<Vec<_>>();
        unsafe { std::env::set_var("NAC_HOME", &home) };
        for name in cleared {
            unsafe { std::env::remove_var(name) };
        }
        Self { original, home }
    }

    /// Opt the process-global catalog into the machine-state layers
    /// (overlay + user overrides) for the duration of the test.
    pub(super) fn with_env_layers(self) -> Self {
        set_env_layers_for_test(true);
        self
    }

    pub(super) fn path(&self) -> &Path {
        &self.home
    }

    pub(super) fn overlay_path(&self) -> PathBuf {
        overlay::overlay_dir(&self.home).join("overlay.json")
    }

    pub(super) fn sidecar_path(&self) -> PathBuf {
        overlay::overlay_dir(&self.home).join("overlay.etag")
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (name, value) in self.original.drain(..) {
            match value {
                Some(value) => unsafe { std::env::set_var(name, value) },
                None => unsafe { std::env::remove_var(name) },
            }
        }
        let _ = std::fs::remove_dir_all(&self.home);
        // No-ops for tests that never opted in or spawned a refresh;
        // panic-safe resets for the ones that did.
        set_env_layers_for_test(false);
        reset_for_test();
        overlay::reset_refresh_for_test();
    }
}
