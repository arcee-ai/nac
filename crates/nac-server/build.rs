// `include_dir!` embeds `assets/` at compile time, but Cargo only tracks Rust
// sources by itself, so editing the frontend would otherwise leave a stale
// binary serving the previous assets.
fn main() {
    println!("cargo:rerun-if-changed=assets");

    // Embed the source revision so `--version` can distinguish two `edge`
    // builds (the release channel is a mutable tag). Falls back to "unknown"
    // when building from a source archive without git metadata.
    let revision = git(&["rev-parse", "--short", "HEAD"]).unwrap_or_else(|| "unknown".to_string());
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
