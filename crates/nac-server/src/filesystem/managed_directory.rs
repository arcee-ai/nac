//! Directory-descriptor adapter for private managed filesystem observations.
use std::{fs::File, io, path::Path};

#[cfg(unix)]
fn open_components(start: File, path: &Path) -> io::Result<File> {
    use std::{
        ffi::CString,
        os::fd::{AsRawFd, FromRawFd},
        os::unix::ffi::OsStrExt,
        path::Component,
    };
    let mut directory = start;
    for component in path.components() {
        let Component::Normal(name) = component else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "noncanonical directory component",
            ));
        };
        let name = CString::new(name.as_bytes()).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidInput, "invalid directory component")
        })?;
        // SAFETY: both the parent descriptor and NUL-terminated component stay
        // live for the call. Each successful descriptor is owned exactly once.
        let descriptor = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: openat returned a fresh owned descriptor, checked above.
        directory = unsafe { File::from_raw_fd(descriptor) };
    }
    // SAFETY: the descriptor is live and "." is a fixed NUL-terminated name.
    // Check the serving process's actual readable/searchable cwd access without
    // changing process cwd or claiming any human's write authorization.
    let access = unsafe {
        libc::faccessat(
            directory.as_raw_fd(),
            c".".as_ptr(),
            libc::R_OK | libc::X_OK,
            libc::AT_EACCESS,
        )
    };
    if access != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(directory)
}

/// Walk from the real filesystem root; no ancestor or final symlink is followed.
#[cfg(unix)]
pub(crate) fn open_absolute_directory(path: &Path) -> io::Result<File> {
    if !path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "absolute directory required",
        ));
    }
    open_components(
        File::open("/")?,
        path.strip_prefix("/").map_err(io::Error::other)?,
    )
}

/// Resolve only normal relative components beneath the pinned root descriptor.
#[cfg(unix)]
pub(crate) fn open_directory_beneath(root: &File, relative: &Path) -> io::Result<File> {
    open_components(root.try_clone()?, relative)
}

#[cfg(not(unix))]
pub(crate) fn open_absolute_directory(_path: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "managed directory facts require Unix",
    ))
}
#[cfg(not(unix))]
pub(crate) fn open_directory_beneath(_root: &File, _relative: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "managed directory facts require Unix",
    ))
}
