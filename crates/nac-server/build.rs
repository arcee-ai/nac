// `include_dir!` embeds `assets/` at compile time, but Cargo only tracks Rust
// sources by itself, so editing the frontend would otherwise leave a stale
// binary serving the previous assets.
fn main() {
    println!("cargo:rerun-if-changed=assets");

    let version_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../version.txt");
    println!("cargo:rerun-if-changed={}", version_path.display());
    let product_version = std::fs::read_to_string(&version_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", version_path.display()));
    let product_version = product_version.trim();
    assert_stable_version(product_version);
    println!("cargo:rustc-env=NAC_PRODUCT_VERSION={product_version}");

    println!("cargo:rerun-if-env-changed=NAC_BUILD_TRACK");
    let build_track = std::env::var("NAC_BUILD_TRACK").unwrap_or_else(|_| "dev".to_string());
    assert!(
        matches!(build_track.as_str(), "dev" | "beta" | "stable"),
        "NAC_BUILD_TRACK must be dev, beta, or stable"
    );
    println!("cargo:rustc-env=NAC_BUILD_TRACK={build_track}");

    println!("cargo:rerun-if-env-changed=NAC_SOURCE_REVISION");
    let source_revision = std::env::var("NAC_SOURCE_REVISION")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| git(&["rev-parse", "HEAD"]))
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=NAC_SOURCE_REVISION={source_revision}");

    println!("cargo:rerun-if-env-changed=NAC_BUILD_ID");
    let build_id = std::env::var("NAC_BUILD_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{build_track}-{source_revision}"));
    println!("cargo:rustc-env=NAC_BUILD_ID={build_id}");

    let revision = source_revision.get(..12).unwrap_or(&source_revision);
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

fn assert_stable_version(version: &str) {
    let components = version.split('.').collect::<Vec<_>>();
    assert!(
        components.len() == 3
            && components.iter().all(|component| {
                !component.is_empty()
                    && component
                        .chars()
                        .all(|character| character.is_ascii_digit())
                    && (component == &"0" || !component.starts_with('0'))
            }),
        "version.txt must contain one stable semantic version"
    );
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
