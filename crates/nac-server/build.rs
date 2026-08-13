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
    // rebuilds keep a stale embedded revision. Watch HEAD plus the ref it
    // points at (branch commits rewrite only the ref) and packed-refs (fresh
    // clones may not have a loose ref file yet). Missing paths simply make
    // Cargo re-run the script, which is cheap when nothing changed.
    if let Some(git_dir) = git(&["rev-parse", "--git-dir"]) {
        let git_dir = std::path::PathBuf::from(git_dir);
        let head = git_dir.join("HEAD");
        println!("cargo:rerun-if-changed={}", head.display());
        println!("cargo:rerun-if-changed={}", git_dir.join("packed-refs").display());
        if let Ok(contents) = std::fs::read_to_string(&head) {
            if let Some(reference) = contents.trim().strip_prefix("ref: ") {
                println!("cargo:rerun-if-changed={}", git_dir.join(reference).display());
            }
        }
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
