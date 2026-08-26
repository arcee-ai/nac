// `include_dir!` embeds `assets/` at compile time, but Cargo only tracks Rust
// sources by itself, so editing the frontend would otherwise leave a stale
// binary serving the previous assets.
fn main() {
    println!("cargo:rerun-if-changed=assets");

    println!("cargo:rerun-if-env-changed=NAC_RELEASE_VERSION");
    let release_version =
        nonempty_env("NAC_RELEASE_VERSION").unwrap_or_else(|| env!("CARGO_PKG_VERSION").into());
    println!("cargo:rustc-env=NAC_RELEASE_VERSION={release_version}");

    // Embed the source revision so release builds remain commit-identifiable.
    // Container builds intentionally exclude `.git` from the build context, so
    // CI can provide the checked-out revision explicitly. Source archives and
    // ad-hoc builds without either input retain the existing "unknown" fallback.
    println!("cargo:rerun-if-env-changed=NAC_BUILD_REVISION");
    let revision = nonempty_env("NAC_BUILD_REVISION")
        .or_else(|| git(&["rev-parse", "--short", "HEAD"]))
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=NAC_BUILD_REVISION={revision}");

    // Re-run this script when the revision moves, otherwise incremental
    // rebuilds keep a stale embedded revision. `--git-path` resolves HEAD in
    // the per-worktree git directory while resolving refs and packed-refs in
    // the common git directory shared by all worktrees.
    if let Some(head) = git(&["rev-parse", "--git-path", "HEAD"]) {
        let head = std::path::PathBuf::from(head);
        println!("cargo:rerun-if-changed={}", head.display());
        watch_git_path("packed-refs");
        if let Ok(contents) = std::fs::read_to_string(&head) {
            if let Some(reference) = contents.trim().strip_prefix("ref: ") {
                watch_git_path(reference);
            }
        }
    }
}

/// Returns a trimmed, non-empty build input.
fn nonempty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Tells Cargo to watch a path after Git resolves its worktree-aware location.
fn watch_git_path(path: &str) {
    if let Some(path) = git(&["rev-parse", "--git-path", path]) {
        println!("cargo:rerun-if-changed={path}");
    }
}

/// Runs git with the given arguments and returns its trimmed stdout, or `None`
/// when git is unavailable or the command fails.
fn git(args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git").args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return None;
    }
    Some(stdout)
}
