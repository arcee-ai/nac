//! Optional local configuration observation, NOT enrolled/current authority.
//! Expectations come from reviewed deployment composition, never this manifest.
//! Successful reads do not qualify certificates, Integrity, custody or native
//! proof, install a listener, rotate pins, or reopen a denied serving lifetime.
use crate::ManagedHostKeyConfig;
use anyhow::{anyhow, bail, Result};
use serde::Deserialize;
use std::{
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_BYTES: u64 = 16_384;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeEnrollmentRole {
    NativeOwner,
    RuntimeObserver,
    IssuerClient,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeEnrollmentPurpose {
    RuntimeObservation,
    IssuerControl,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeEnrollmentReleaseBinding {
    pub release_id: String,
    pub source_revision: String,
    pub artifact_sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeEnrollmentPeer {
    pub purpose: RuntimeEnrollmentPurpose,
    pub leaf_sha256: String,
    pub ca_sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeEnrollmentCredentialFiles {
    pub certificate_chain: PathBuf,
    pub private_key: PathBuf,
    pub peer_ca: PathBuf,
}

/// Nonsecret parsed configuration only. No conversion to enrollment/proof exists.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeEnrollmentConfigurationCandidate {
    pub version: i64,
    pub role: RuntimeEnrollmentRole,
    pub host_binding: ManagedHostKeyConfig,
    pub runtime_release_binding: RuntimeEnrollmentReleaseBinding,
    pub enrollment_generation: i64,
    pub valid_until_epoch_ms: i64,
    pub peer: RuntimeEnrollmentPeer,
    pub local_credential_files: RuntimeEnrollmentCredentialFiles,
}

/// Independently recorded protected mount identity; not deserializable here.
#[derive(Clone, Debug)]
pub struct RuntimeEnrollmentMountExpectation {
    pub path: PathBuf,
    pub device: u64,
    pub inode: u64,
    pub owner_uid: u32,
    pub owner_gid: u32,
}

/// Caller-selected deployment facts, not a credential/authority constructor.
/// Within one serving lifetime these expectations must remain immutable.
pub struct RuntimeEnrollmentExpectations {
    pub configuration_path: PathBuf,
    pub mount: RuntimeEnrollmentMountExpectation,
    pub file_owner_uid: u32,
    pub file_owner_gid: u32,
    pub role: RuntimeEnrollmentRole,
    pub host_binding: ManagedHostKeyConfig,
    pub runtime_release_binding: RuntimeEnrollmentReleaseBinding,
    pub enrollment_generation: i64,
    pub maximum_valid_until_epoch_ms: i64,
    pub peer: RuntimeEnrollmentPeer,
    pub local_credential_files: RuntimeEnrollmentCredentialFiles,
}

impl RuntimeEnrollmentConfigurationCandidate {
    /// Missing optional path returns None before validating expectations or I/O.
    /// Fixed paths/pins/identity come from a separate reviewed composition input.
    pub fn load_optional(
        path: Option<&Path>,
        expected: &RuntimeEnrollmentExpectations,
    ) -> Result<Option<Self>> {
        let Some(path) = path else {
            return Ok(None);
        };
        if path.as_os_str() != expected.configuration_path.as_os_str() {
            bail!("runtime configuration path does not match deployment selection");
        }
        Self::load_selected(expected).map(Some)
    }

    #[cfg(unix)]
    fn load_selected(expected: &RuntimeEnrollmentExpectations) -> Result<Self> {
        let started_epoch_ms = now_ms()?;
        let started_monotonic = std::time::Instant::now();
        expected.validate()?;
        let mount = mounted::Mount::open(&expected.mount)?;
        let mut manifest = mount.open_file(&expected.configuration_path, expected, false)?;
        let raw = manifest.read_bounded()?;
        // Typed structs reject duplicate and unknown fields at every level.
        let candidate: Self = serde_json::from_slice(&raw).map_err(|_| unavailable())?;
        candidate.compare(expected, started_epoch_ms)?;
        let mut files = Vec::new();
        for (path, private) in [
            (&expected.local_credential_files.certificate_chain, false),
            (&expected.local_credential_files.private_key, true),
            (&expected.local_credential_files.peer_ca, false),
        ] {
            let mut file = mount.open_file(path, expected, private)?;
            // Values stay internal and are discarded. This is not PEM/DER,
            // cert/key matching, CA verification or peer enrollment validation.
            let _ = file.read_bounded()?;
            files.push((path, private, file));
        }
        manifest.check_unchanged()?;
        for (_, _, file) in &files {
            file.check_unchanged()?;
        }
        let readback = mounted::Mount::open(&expected.mount)?;
        mount.check_unchanged()?;
        readback.same_mount(&mount)?;
        readback
            .open_file(&expected.configuration_path, expected, false)?
            .same_file(&manifest)?;
        for (path, private, file) in &files {
            readback
                .open_file(path, expected, *private)?
                .same_file(file)?;
        }
        let received_epoch_ms = now_ms()?;
        if received_epoch_ms < started_epoch_ms
            || started_monotonic.elapsed().as_millis()
                >= u128::try_from(candidate.valid_until_epoch_ms - started_epoch_ms)?
        {
            return Err(unavailable());
        }
        candidate.compare(expected, received_epoch_ms)?;
        Ok(candidate)
    }

    #[cfg(not(unix))]
    fn load_selected(expected: &RuntimeEnrollmentExpectations) -> Result<Self> {
        expected.validate()?;
        Err(unavailable())
    }

    #[cfg(unix)]
    fn compare(&self, expected: &RuntimeEnrollmentExpectations, now: i64) -> Result<()> {
        if self.version != 1
            || self.role != expected.role
            || self.host_binding != expected.host_binding
            || self.runtime_release_binding != expected.runtime_release_binding
            || self.enrollment_generation != expected.enrollment_generation
            || self.peer != expected.peer
            || self.local_credential_files != expected.local_credential_files
            || self.valid_until_epoch_ms <= now
            || self.valid_until_epoch_ms > expected.maximum_valid_until_epoch_ms
        {
            return Err(unavailable());
        }
        Ok(())
    }
}

impl RuntimeEnrollmentExpectations {
    fn validate(&self) -> Result<()> {
        validate_host(&self.host_binding)?;
        identifier(&self.runtime_release_binding.release_id, 256)?;
        hex_value(&self.runtime_release_binding.source_revision, 40)?;
        hex_value(&self.runtime_release_binding.artifact_sha256, 64)?;
        hex_value(&self.peer.leaf_sha256, 64)?;
        hex_value(&self.peer.ca_sha256, 64)?;
        if self.enrollment_generation <= 0
            || self.maximum_valid_until_epoch_ms <= now_ms()?
            || matches!(
                (self.role, self.peer.purpose),
                (
                    RuntimeEnrollmentRole::RuntimeObserver,
                    RuntimeEnrollmentPurpose::IssuerControl
                ) | (
                    RuntimeEnrollmentRole::IssuerClient,
                    RuntimeEnrollmentPurpose::RuntimeObservation
                )
            )
        {
            return Err(unavailable());
        }
        absolute(&self.mount.path)?;
        let paths = [
            &self.configuration_path,
            &self.local_credential_files.certificate_chain,
            &self.local_credential_files.private_key,
            &self.local_credential_files.peer_ca,
        ];
        for (index, path) in paths.iter().enumerate() {
            absolute(path)?;
            let relative = path
                .strip_prefix(&self.mount.path)
                .map_err(|_| unavailable())?;
            if relative.as_os_str().is_empty() || paths[..index].contains(path) {
                return Err(unavailable());
            }
        }
        Ok(())
    }
}

fn validate_host(host: &ManagedHostKeyConfig) -> Result<()> {
    for value in [
        &host.bootstrap_id,
        &host.managed_host_id,
        &host.organization_id,
        &host.local_key_id,
    ] {
        if uuid::Uuid::parse_str(value)
            .map_err(|_| unavailable())?
            .to_string()
            != *value
        {
            return Err(unavailable());
        }
    }
    for value in [
        &host.host_incarnation_id,
        &host.pvc_uid,
        &host.key_id,
        &host.clerk_instance_id,
    ] {
        identifier(value, 256)?;
    }
    if host.owner_epoch == 0
        || host.key_generation == 0
        || host.owner_epoch > i64::MAX as u64
        || host.key_generation > i64::MAX as u64
    {
        return Err(unavailable());
    }
    let origin = url::Url::parse(&host.inference_origin).map_err(|_| unavailable())?;
    if origin.scheme() != "https" || origin.origin().ascii_serialization() != host.inference_origin
    {
        return Err(unavailable());
    }
    Ok(())
}
fn identifier(text: &str, maximum: usize) -> Result<()> {
    if text.is_empty()
        || text.len() > maximum
        || text.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(unavailable());
    }
    Ok(())
}
fn hex_value(text: &str, length: usize) -> Result<()> {
    if text.len() != length
        || text
            .bytes()
            .any(|b| !b.is_ascii_digit() && !(b'a'..=b'f').contains(&b))
        || text.bytes().all(|b| b == b'0')
    {
        return Err(unavailable());
    }
    Ok(())
}
fn absolute(path: &Path) -> Result<()> {
    let text = path.to_str().ok_or_else(unavailable)?;
    if !path.is_absolute() || text.len() > 4096 || text.chars().any(char::is_control) {
        return Err(unavailable());
    }
    let mut rebuilt = PathBuf::new();
    for component in path.components() {
        if !matches!(component, Component::RootDir | Component::Normal(_)) {
            return Err(unavailable());
        }
        rebuilt.push(component);
    }
    if rebuilt.as_os_str() != path.as_os_str() {
        return Err(unavailable());
    }
    Ok(())
}
fn now_ms() -> Result<i64> {
    Ok(i64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| unavailable())?
            .as_millis(),
    )?)
}
fn unavailable() -> anyhow::Error {
    anyhow!("runtime enrollment configuration candidate unavailable")
}

#[cfg(unix)]
mod mounted {
    use super::*;
    use std::{
        ffi::CString,
        fs::{File, Metadata, OpenOptions},
        io::Read,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::{
                ffi::OsStrExt,
                fs::{MetadataExt, OpenOptionsExt},
            },
        },
    };
    const FLAGS: i32 = libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC;

    fn open_at(directory: &File, name: &std::ffi::OsStr, is_directory: bool) -> Result<File> {
        let name = CString::new(name.as_bytes()).map_err(|_| unavailable())?;
        let flags = FLAGS | if is_directory { libc::O_DIRECTORY } else { 0 };
        // SAFETY: live directory descriptor, NUL-terminated relative component;
        // no creation, following, blocking special-file open or inherited FD.
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(unavailable());
        }
        // SAFETY: openat returned a new owned descriptor; transferred exactly once.
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    fn same(left: &Metadata, right: &Metadata) -> bool {
        left.dev() == right.dev()
            && left.ino() == right.ino()
            && left.mode() == right.mode()
            && left.uid() == right.uid()
            && left.gid() == right.gid()
            && left.len() == right.len()
            && left.nlink() == right.nlink()
            && left.mtime() == right.mtime()
            && left.mtime_nsec() == right.mtime_nsec()
            && left.ctime() == right.ctime()
            && left.ctime_nsec() == right.ctime_nsec()
    }
    fn protected_directory(
        metadata: &Metadata,
        expected: &RuntimeEnrollmentMountExpectation,
    ) -> Result<()> {
        if !metadata.is_dir()
            || metadata.mode() & 0o022 != 0
            || metadata.uid() != expected.owner_uid
            || metadata.gid() != expected.owner_gid
        {
            return Err(unavailable());
        }
        Ok(())
    }
    pub(super) struct Mount {
        root: File,
        before: Metadata,
        expected: RuntimeEnrollmentMountExpectation,
    }
    impl Mount {
        pub(super) fn open(expected: &RuntimeEnrollmentMountExpectation) -> Result<Self> {
            let mut root = OpenOptions::new()
                .read(true)
                .custom_flags(FLAGS | libc::O_DIRECTORY)
                .open("/")
                .map_err(|_| unavailable())?;
            for component in expected.path.components() {
                if let Component::Normal(name) = component {
                    root = open_at(&root, name, true)?;
                }
            }
            let before = root.metadata().map_err(|_| unavailable())?;
            protected_directory(&before, expected)?;
            if before.dev() != expected.device || before.ino() != expected.inode {
                return Err(unavailable());
            }
            Ok(Self {
                root,
                before,
                expected: expected.clone(),
            })
        }
        pub(super) fn check_unchanged(&self) -> Result<()> {
            if !same(
                &self.before,
                &self.root.metadata().map_err(|_| unavailable())?,
            ) {
                return Err(unavailable());
            }
            Ok(())
        }
        pub(super) fn same_mount(&self, other: &Self) -> Result<()> {
            if !same(&self.before, &other.before) {
                return Err(unavailable());
            }
            Ok(())
        }
        pub(super) fn open_file(
            &self,
            path: &Path,
            expected: &RuntimeEnrollmentExpectations,
            private: bool,
        ) -> Result<LoadedFile> {
            let relative = path
                .strip_prefix(&self.expected.path)
                .map_err(|_| unavailable())?;
            let names: Vec<_> = relative
                .components()
                .map(|component| match component {
                    Component::Normal(name) => Ok(name),
                    _ => Err(unavailable()),
                })
                .collect::<Result<_>>()?;
            let (leaf, ancestors) = names.split_last().ok_or_else(unavailable)?;
            let mut directories = Vec::new();
            for name in ancestors {
                let parent = directories
                    .last()
                    .map(|(file, _): &(File, Metadata)| file)
                    .unwrap_or(&self.root);
                let directory = open_at(parent, name, true)?;
                let metadata = directory.metadata().map_err(|_| unavailable())?;
                protected_directory(&metadata, &self.expected)?;
                directories.push((directory, metadata));
            }
            let parent = directories
                .last()
                .map(|(file, _)| file)
                .unwrap_or(&self.root);
            let file = open_at(parent, leaf, false)?;
            let before = file.metadata().map_err(|_| unavailable())?;
            if !before.is_file()
                || before.len() == 0
                || before.len() > MAX_BYTES
                || before.uid() != expected.file_owner_uid
                || before.gid() != expected.file_owner_gid
                || before.mode() & 0o022 != 0
                || (private && before.mode() & 0o077 != 0)
            {
                return Err(unavailable());
            }
            Ok(LoadedFile {
                file,
                before,
                directories,
            })
        }
    }
    pub(super) struct LoadedFile {
        file: File,
        before: Metadata,
        directories: Vec<(File, Metadata)>,
    }
    impl LoadedFile {
        #[cfg(test)]
        pub(super) fn fixture_descriptor_flags(&self) -> (i32, i32) {
            // SAFETY: borrowed live descriptor; fcntl reads flags only.
            unsafe {
                (
                    libc::fcntl(self.file.as_raw_fd(), libc::F_GETFD),
                    libc::fcntl(self.file.as_raw_fd(), libc::F_GETFL),
                )
            }
        }
        pub(super) fn read_bounded(&mut self) -> Result<Vec<u8>> {
            let mut raw = Vec::new();
            (&mut self.file)
                .take(MAX_BYTES + 1)
                .read_to_end(&mut raw)
                .map_err(|_| unavailable())?;
            if raw.len() as u64 != self.before.len() || raw.len() as u64 > MAX_BYTES {
                return Err(unavailable());
            }
            self.check_unchanged()?;
            Ok(raw)
        }
        pub(super) fn check_unchanged(&self) -> Result<()> {
            if !same(
                &self.before,
                &self.file.metadata().map_err(|_| unavailable())?,
            ) {
                return Err(unavailable());
            }
            for (directory, metadata) in &self.directories {
                if !same(metadata, &directory.metadata().map_err(|_| unavailable())?) {
                    return Err(unavailable());
                }
            }
            Ok(())
        }
        pub(super) fn same_file(&self, other: &Self) -> Result<()> {
            if !same(&self.before, &other.before)
                || self.directories.len() != other.directories.len()
                || self
                    .directories
                    .iter()
                    .zip(&other.directories)
                    .any(|((_, left), (_, right))| !same(left, right))
            {
                return Err(unavailable());
            }
            Ok(())
        }
    }
}

#[cfg(test)]
#[path = "runtime_enrollment_configuration_tests.rs"]
mod tests;
