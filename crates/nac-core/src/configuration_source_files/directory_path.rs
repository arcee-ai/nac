//! Actual original directory namespace, including the first absent component.
use super::*;
use std::path::{Component, PathBuf};

pub(crate) struct DirectoryPath {
    path: PathBuf,
    anchor: ParentAnchor,
    missing: Vec<CString>,
}
impl DirectoryPath {
    pub(crate) fn capture(path: &Path) -> Result<Self> {
        ensure!(path.is_absolute(), "source directory must be absolute");
        let source = Self {
            path: PathBuf::from("/"),
            anchor: ParentAnchor::capture(Path::new("/"))?,
            missing: Vec::new(),
        };
        source.descend(path.strip_prefix("/")?)
    }
    pub(crate) fn descend(&self, relative: &Path) -> Result<Self> {
        ensure!(!relative.is_absolute(), "source child must be relative");
        self.check()?;
        let mut source = Self {
            path: self.path.clone(),
            anchor: self.anchor.try_clone()?,
            missing: self.missing.clone(),
        };
        for component in relative.components() {
            let Component::Normal(component) = component else {
                anyhow::bail!("invalid source directory component");
            };
            let component = name(component)?;
            if source.missing.is_empty() {
                match source.anchor.child(&component)? {
                    Some(anchor) => source.anchor = anchor,
                    None => source.missing.push(component),
                }
            } else {
                source.missing.push(component);
            }
        }
        source.path.push(relative);
        source.check()?;
        Ok(source)
    }
    pub(crate) fn check(&self) -> Result<()> {
        self.anchor.check()?;
        if let Some(first) = self.missing.first() {
            ensure!(
                self.anchor.child(first)?.is_none(),
                "absent source directory appeared"
            );
        }
        Ok(())
    }
    pub(crate) fn regular(&self, component: &OsStr) -> Result<Option<File>> {
        self.check()?;
        if !self.missing.is_empty() {
            return Ok(None);
        }
        self.anchor.regular(&name(component)?, libc::O_RDONLY)
    }
    pub(crate) fn entries(&self) -> Result<Vec<(std::ffi::OsString, bool, bool)>> {
        self.check()?;
        let Some(file) = self.directory()? else {
            return Ok(Vec::new());
        };
        let directory = cap_std::fs::Dir::from_std_file(file.try_clone()?);
        let mut entries = Vec::new();
        for entry in directory.entries()? {
            let entry = entry?;
            let kind = entry.file_type()?;
            entries.push((entry.file_name(), kind.is_dir(), kind.is_file()));
        }
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        self.check()?;
        Ok(entries)
    }
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
    pub(crate) fn directory(&self) -> Result<Option<&File>> {
        if !self.missing.is_empty() {
            return Ok(None);
        }
        Ok(Some(self.anchor.directory_file()?))
    }
}
