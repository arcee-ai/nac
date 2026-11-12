//! CLI composition of installation ownership. Package identity restricts
//! self-upgrade; it never authenticates a publisher or authorizes replacement.

use std::{
    fs::OpenOptions,
    io::Read,
    path::{Path, PathBuf},
};

use anyhow::{ensure, Context, Result};
use nac_core::upgrade::{UpgradeOwnership, WHOLE_APPLICATION_UPGRADE_GUIDANCE};
use serde::Deserialize;

use crate::build_identity::{self, BuildIdentity};

// The package includes the asset inventory and native build receipt. It is
// larger than the unrelated private desktop-channel records (16 KiB).
const PACKAGE_IDENTITY_LIMIT: u64 = 2 * 1024 * 1024;

/// Bind ownership to the running executable, never argv[0], INSTALL_DIR,
/// --install-dir, or an ambient track. Resolve invocation symlinks first.
pub fn current_upgrade_ownership() -> Result<UpgradeOwnership> {
    ownership_for_executable(
        &std::env::current_exe().context("failed to determine nac-web executable path")?,
        build_identity::current(),
    )
}

fn ownership_for_executable(executable: &Path, build: BuildIdentity) -> Result<UpgradeOwnership> {
    let executable = executable
        .canonicalize()
        .context("failed to resolve nac-web executable path; self-upgrade refused")?;
    let Some(marker) = package_identity_path(&executable) else {
        return Ok(UpgradeOwnership::Standalone);
    };

    // A recognized bundle remains restricted if incomplete, modified, or built
    // by the raw native builder before packaging added PackageIdentity.json.
    read_matching_identity(&marker, build).with_context(|| {
        format!("{WHOLE_APPLICATION_UPGRADE_GUIDANCE} The bundled PackageIdentity.json is missing, unreadable, or does not match this engine; obtain a coherent whole app.")
    })?;
    Ok(UpgradeOwnership::WholeApplication)
}

fn package_identity_path(executable: &Path) -> Option<PathBuf> {
    let resources = executable.parent()?;
    let contents = resources.parent()?;
    let app = contents.parent()?;
    (executable.file_name()? == "nac-web"
        && resources.file_name()? == "Resources"
        && contents.file_name()? == "Contents"
        && app.extension()? == "app")
        .then(|| resources.join("PackageIdentity.json"))
}

#[derive(Deserialize)]
struct PackageIdentity {
    schema_version: u32,
    engine_identity: EngineIdentity,
}

#[derive(Deserialize)]
struct EngineIdentity {
    product_version: String,
    build_id: String,
    source_revision: String,
    track: String,
}

fn read_matching_identity(marker: &Path, build: BuildIdentity) -> Result<()> {
    // Open the marker itself without following a symlink or blocking on a FIFO.
    // The canonical executable already binds the bundle layout above. Even a
    // racing marker replacement can only change the diagnostic, never permit
    // self-upgrade of a recognized app engine.
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    ensure!(
        std::fs::symlink_metadata(marker)?.is_file(),
        "package identity must be a regular file"
    );
    let file = options.open(marker)?;
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file() && metadata.len() <= PACKAGE_IDENTITY_LIMIT,
        "package identity must be a bounded regular file"
    );
    let mut bytes = Vec::new();
    file.take(PACKAGE_IDENTITY_LIMIT + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= PACKAGE_IDENTITY_LIMIT,
        "package identity exceeds its read bound"
    );
    let package: PackageIdentity = serde_json::from_slice(&bytes)?;
    let identity = package.engine_identity;
    ensure!(
        package.schema_version == 1
            && identity.product_version == build.product_version
            && identity.build_id == build.build_id
            && identity.source_revision == build.source_revision
            && identity.track == build.track,
        "package identity differs from the compiled engine identity"
    );
    // Purpose/consumer_distribution are not upgrade authority. engine_input
    // hashes pre-signing bytes; signed executable bytes must not be compared.
    Ok(())
}

#[cfg(test)]
#[path = "executable_upgrade_tests.rs"]
mod tests;
