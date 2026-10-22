//! Compatibility for an owner's otherwise-empty ephemeral private directory.
use super::*;
pub(crate) fn remove_empty_private_directory(path: &Path) -> Result<()> {
    let mut entries = fs::read_dir(path)?;
    let Some(entry) = entries.next() else {
        fs::remove_dir(path)?;
        return Ok(());
    };
    ensure!(
        entry?.file_name() == OsStr::new(GATE) && entries.next().is_none(),
        "private directory is not empty"
    );
    let mut options = OpenOptions::new();
    options.read(true);
    use std::os::unix::fs::OpenOptionsExt;
    options.custom_flags(libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW);
    let root = options.open(path)?;
    let original = open(&root, OsStr::new(GATE), libc::O_RDWR)?;
    ensure_open_credential_file_is_safe(&original, Path::new(GATE))?;
    FileExt::try_lock_exclusive(&original).map_err(|_| unavailable())?;
    let current = open(&root, OsStr::new(GATE), libc::O_RDWR)?;
    ensure!(
        identity(&original)? == identity(&current)?
            && original.metadata()?.nlink() == 1
            && original.metadata()?.len() == 0,
        "private directory gate is active or quarantined"
    );
    let component = name(OsStr::new(GATE))?;
    // SAFETY: only the original empty gate component in the retained directory
    // is unlinked, while its exclusive lock prevents existing mutators.
    if unsafe { libc::unlinkat(root.as_raw_fd(), component.as_ptr(), 0) } != 0 {
        return Err(io::Error::last_os_error().into());
    }
    root.sync_all()?;
    // Ordinary remove_dir still refuses any racing/unrelated file; no recursive
    // removal, quarantine reset or resource retirement is inferred here.
    fs::remove_dir(path)?;
    Ok(())
}
