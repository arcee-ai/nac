//! Shared compile-time identity adapter for inward contracts and the product binary.
pub fn configure() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=../../scripts/build-identity.rs");
    // Cargo may reuse this executable after the checkout or target cache moves.
    let manifest_dir = std::env::var_os("CARGO_MANIFEST_DIR").unwrap_or_else(|| {
        panic!("Cargo must set CARGO_MANIFEST_DIR when running the build script")
    });
    let version_path = std::path::Path::new(&manifest_dir).join("../../version.txt");
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
    let explicit_source_revision = std::env::var("NAC_SOURCE_REVISION")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let source_revision = explicit_source_revision
        .clone()
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

    // An explicit candidate revision is the source of truth for release/image
    // builds. Git metadata cannot change that identity.
    if explicit_source_revision.is_none() {
        watch_git_identity();
    }
}

fn watch_git_identity() {
    // HEAD belongs to this worktree; refs and packed-refs may belong to the
    // shared Git directory. Watch only the files used to resolve this HEAD.
    // A missing rerun-if-changed path makes Cargo rebuild on EVERY invocation.
    if let Some(head) = git(&["rev-parse", "--git-path", "HEAD"]) {
        let mut path = std::path::PathBuf::from(head);
        let mut visited = std::collections::HashSet::new();
        while visited.insert(path.clone()) {
            watch_existing_path_or_parent(&path);
            match std::fs::read_to_string(&path) {
                Ok(contents) => {
                    let Some(reference) = contents.trim().strip_prefix("ref: ") else {
                        break;
                    };
                    let Some(reference_path) = git(&["rev-parse", "--git-path", reference]) else {
                        break;
                    };
                    path = std::path::PathBuf::from(reference_path);
                }
                Err(_) => {
                    // The loose ref can be absent because it is packed (or
                    // unborn). Its existing parent detects a new loose ref;
                    // packed-refs detects packed updates. Conversely, packing
                    // a previously loose ref removes its watched file, which
                    // reruns this script and selects these dependencies.
                    if let Some(packed) = git(&["rev-parse", "--git-path", "packed-refs"]) {
                        watch_existing_path_or_parent(std::path::Path::new(&packed));
                    }
                    break;
                }
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

/// Watch creation of an absent ref without giving Cargo a nonexistent path.
fn watch_existing_path_or_parent(path: &std::path::Path) {
    let mut existing = path;
    while !existing.exists() {
        let Some(parent) = existing.parent() else {
            return;
        };
        existing = parent;
    }
    println!("cargo:rerun-if-changed={}", existing.display());
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
