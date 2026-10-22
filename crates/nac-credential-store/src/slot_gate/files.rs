//! Descriptor-relative bounded reads and atomic private-file publication.
use super::*;
impl ReservedCredentialIo<'_> {
    pub fn exists(&self, component: &OsStr) -> Result<bool> {
        self.0.check_current()?;
        let component = name(component)?;
        let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
        // SAFETY: valid retained directory/name and writable stat allocation.
        let rc = unsafe {
            libc::fstatat(
                self.0.root.as_raw_fd(),
                component.as_ptr(),
                stat.as_mut_ptr(),
                libc::AT_SYMLINK_NOFOLLOW,
            )
        };
        if rc == 0 {
            return Ok(true);
        }
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::NotFound {
            Ok(false)
        } else {
            Err(error.into())
        }
    }
    pub fn read(&self, component: &OsStr, maximum: usize) -> Result<Option<Vec<u8>>> {
        self.0.check_current()?;
        if !self.exists(component)? {
            return Ok(None);
        }
        ensure!(maximum <= 256 * 1024, "credential read bound unavailable");
        let file = open(&self.0.root, component, libc::O_RDONLY)?;
        ensure_open_credential_file_is_safe(&file, Path::new(component))?;
        let mut bytes = Vec::new();
        file.take(maximum as u64 + 1).read_to_end(&mut bytes)?;
        ensure!(bytes.len() <= maximum, "credential file exceeds limit");
        self.0.check_current()?;
        Ok(Some(bytes))
    }
    pub fn write(&self, component: &OsStr, raw: &str) -> Result<()> {
        self.0.check_current()?;
        let destination = name(component)?;
        // Existing symlink/nonregular destinations refuse before publication.
        if self.exists(component)? {
            let file = open(&self.0.root, component, libc::O_RDONLY)?;
            ensure_open_credential_file_is_safe(&file, Path::new(component))?;
        }
        let temporary = OsString::from(format!(".nac-slot-{}", Uuid::new_v4()));
        let temporary_name = name(&temporary)?;
        let result = (|| {
            let mut file = open(
                &self.0.root,
                &temporary,
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL,
            )?;
            file.write_all(raw.as_bytes())?;
            file.sync_all()?;
            self.0.check_current()?;
            // SAFETY: both names belong to the same retained directory.
            let rc = unsafe {
                libc::renameat(
                    self.0.root.as_raw_fd(),
                    temporary_name.as_ptr(),
                    self.0.root.as_raw_fd(),
                    destination.as_ptr(),
                )
            };
            if rc != 0 {
                return Err(io::Error::last_os_error().into());
            }
            self.0.root.sync_all()?;
            self.0.check_current()
        })();
        if result.is_err() {
            // SAFETY: cleanup addresses only this random temporary component.
            unsafe { libc::unlinkat(self.0.root.as_raw_fd(), temporary_name.as_ptr(), 0) };
        }
        result
    }
}
use std::ffi::OsString;
