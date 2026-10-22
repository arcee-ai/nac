//! Original no-follow guidance sources. Only the concrete retained participant
//! and its genuine context may build this owner. No caller-supplied reader.
use super::protected_execution::guidance_capture::GuidanceBytes;
use super::*;
use crate::configuration_source_files::DirectoryPath;
use anyhow::ensure;
use sha2::{Digest, Sha256};
use std::{
    ffi::{OsStr, OsString},
    fs::{File, Metadata},
    os::unix::fs::{FileExt, MetadataExt},
    sync::{Arc, Mutex},
};

#[derive(PartialEq, Eq)]
struct Stamp {
    dev: u64,
    ino: u64,
    mode: u32,
    uid: u32,
    gid: u32,
    len: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}
impl Stamp {
    fn of(meta: Metadata) -> Self {
        Self {
            dev: meta.dev(),
            ino: meta.ino(),
            mode: meta.mode(),
            uid: meta.uid(),
            gid: meta.gid(),
            len: meta.len(),
            modified: (meta.mtime(), meta.mtime_nsec()),
            changed: (meta.ctime(), meta.ctime_nsec()),
        }
    }
}
struct FileSource {
    parent: DirectoryPath,
    name: OsString,
    original: Option<(File, Stamp, [u8; 32], GuidanceBytes)>,
}
struct DirectorySource {
    directory: DirectoryPath,
    entries: Vec<(OsString, bool, bool)>,
}
/// Original serving attempt retains this Arc before content reads, including
/// all failed preparation and later service lifetime. No serialized admission.
pub(in crate::runtime) struct GuidanceReadOwner {
    participant: Arc<create_participant::CreateParticipant>,
    context: Arc<ProtectedExecutionContext>,
    files: Mutex<Vec<FileSource>>,
    directories: Mutex<Vec<DirectorySource>>,
}
impl GuidanceReadOwner {
    pub(in crate::runtime) fn retain(
        participant: Arc<create_participant::CreateParticipant>,
        context: Arc<ProtectedExecutionContext>,
    ) -> Arc<Self> {
        Arc::new(Self {
            participant,
            context,
            files: Mutex::new(Vec::new()),
            directories: Mutex::new(Vec::new()),
        })
    }
    fn guard(&self) -> Result<()> {
        self.participant.check_guidance_context(&self.context)
    }
    pub(in crate::runtime) fn check_current(&self) -> Result<()> {
        self.guard()?;
        for entry in self
            .files
            .lock()
            .map_err(|_| anyhow::anyhow!("guidance file custody poisoned"))?
            .iter()
        {
            entry.parent.check()?;
            let observed = entry.parent.regular(&entry.name)?;
            match (&entry.original, observed) {
                (None, None) => {}
                (Some((file, stamp, hash, _)), Some(current)) => {
                    ensure!(
                        Stamp::of(file.metadata()?) == *stamp
                            && Stamp::of(current.metadata()?) == *stamp
                            && self.hash_file(file, stamp.len)? == *hash
                            && Stamp::of(file.metadata()?) == *stamp,
                        "original guidance file changed"
                    );
                }
                _ => anyhow::bail!("original guidance presence changed"),
            }
        }
        for entry in self
            .directories
            .lock()
            .map_err(|_| anyhow::anyhow!("guidance directory custody poisoned"))?
            .iter()
        {
            ensure!(
                entry.directory.entries()? == entry.entries,
                "guidance directory changed"
            );
        }
        self.guard()
    }
    /// Fixed preparation caller selects only AGENTS/configured fallbacks or
    /// discovered SKILL.md under the retained roots. Never a model tool RPC.
    pub(in crate::runtime) fn read_text(
        &self,
        parent: &DirectoryPath,
        name: &OsStr,
    ) -> Result<Option<String>> {
        self.guard()?;
        let parent = parent.descend(Path::new(""))?;
        let Some(file) = parent.regular(name)? else {
            self.files
                .lock()
                .map_err(|_| anyhow::anyhow!("guidance custody poisoned"))?
                .push(FileSource {
                    parent,
                    name: name.to_owned(),
                    original: None,
                });
            self.guard()?;
            return Ok(None);
        };
        let stamp = Stamp::of(file.metadata()?);
        let len = usize::try_from(stamp.len)?;
        // Raw bytes plus decoded/trimmed preparation text share one original
        // quota. This is a payload bound, not total allocator/RSS qualification.
        let capture = self.context.reserve_guidance_capture(
            len.checked_mul(3)
                .ok_or_else(|| anyhow::anyhow!("guidance storage overflow"))?,
        )?;
        let mut bytes = vec![0_u8; len];
        let mut offset = 0;
        while offset < len {
            self.guard()?;
            let count = file.read_at(&mut bytes[offset..], offset as u64)?;
            ensure!(count > 0, "guidance source shortened");
            offset += count;
        }
        ensure!(
            Stamp::of(file.metadata()?) == stamp,
            "guidance source changed during read"
        );
        let hash: [u8; 32] = Sha256::digest(&bytes).into();
        let bytes = capture.finish(bytes)?;
        // Retain FD and charge BEFORE decoding or any later fallible check.
        let mut files = self
            .files
            .lock()
            .map_err(|_| anyhow::anyhow!("guidance custody poisoned"))?;
        files.push(FileSource {
            parent,
            name: name.to_owned(),
            original: Some((file, stamp, hash, bytes)),
        });
        let raw = &files
            .last()
            .ok_or_else(|| anyhow::anyhow!("guidance source absent"))?
            .original
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("guidance source absent"))?
            .3;
        let text = std::str::from_utf8(raw.bytes())?.to_owned();
        drop(files);
        self.check_current()?;
        Ok(Some(text))
    }
    pub(in crate::runtime) fn entries(
        &self,
        directory: &DirectoryPath,
    ) -> Result<Vec<(OsString, bool, bool)>> {
        self.guard()?;
        let original = directory.descend(Path::new(""))?;
        let entries = original.entries()?;
        self.directories
            .lock()
            .map_err(|_| anyhow::anyhow!("guidance custody poisoned"))?
            .push(DirectorySource {
                directory: original,
                entries: entries.clone(),
            });
        self.guard()?;
        Ok(entries)
    }
    pub(in crate::runtime) fn global_and_workspace(
        &self,
    ) -> Result<(Arc<CreateGlobalPreparationSource>, String, PathBuf)> {
        self.guard()?;
        self.participant.guidance_material()
    }

    fn hash_file(&self, file: &File, len: u64) -> Result<[u8; 32]> {
        let mut digest = Sha256::new();
        let mut bytes = [0_u8; 65536];
        let mut offset = 0;
        while offset < len {
            self.guard()?;
            let wanted = usize::try_from((len - offset).min(bytes.len() as u64))?;
            let count = file.read_at(&mut bytes[..wanted], offset)?;
            ensure!(count > 0, "original guidance file shortened");
            digest.update(&bytes[..count]);
            offset += count as u64;
        }
        self.guard()?;
        Ok(digest.finalize().into())
    }
}
