use anyhow::Result;
use std::io::Read;
use std::path::{Path, PathBuf};

const SQLITE_HEADER_LENGTH: usize = 64;
const SQLITE_PAGE_SIZE_OFFSET: usize = 16;
const USER_VERSION_OFFSET: usize = 60;
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const WAL_HEADER_LENGTH: usize = 32;
const FRAME_HEADER_LENGTH: usize = 24;
const WAL_MAGIC_LITTLE_ENDIAN_CHECKSUMS: u32 = 0x377f_0682;
const WAL_MAGIC_BIG_ENDIAN_CHECKSUMS: u32 = 0x377f_0683;
const WAL_FORMAT_VERSION: u32 = 3_007_000;

/// Read page one's effective user_version without opening a SQLite pager. Invalid or
/// incomplete WAL content is ignored exactly as SQLite recovery ignores it, so
/// it cannot mask a future main-database schema and cause a mutating open.
pub(super) fn read_schema_version_header(path: &Path) -> Result<Option<i64>> {
    let header = match read_main_header(path) {
        Ok(header) => header,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if &header[..SQLITE_MAGIC.len()] != SQLITE_MAGIC {
        return Ok(None);
    }
    let main_version = read_be_u32(&header[USER_VERSION_OFFSET..USER_VERSION_OFFSET + 4]);
    let main_page_size = sqlite_page_size(&header);
    Ok(Some(
        read_wal_schema_version(path, main_page_size)?.unwrap_or_else(|| i64::from(main_version)),
    ))
}

/// Main-file closes must go through SQLite's VFS: closing an unrelated POSIX
/// descriptor releases this process's SQLite locks on the same inode. A VFS
/// file participates in SQLite's deferred-close bookkeeping without creating
/// a pager, migrating, recovering, or opening WAL/shared-memory sidecars.
fn read_main_header(path: &Path) -> std::io::Result<[u8; SQLITE_HEADER_LENGTH]> {
    use rusqlite::ffi;
    use std::ffi::CString;
    use std::ptr;

    let path = std::fs::canonicalize(path)?;
    let path = CString::new(path.as_os_str().as_encoded_bytes())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    // SAFETY: SQLite initializes and returns its registered default VFS. Its
    // immutable methods remain live for the lifetime of this scoped handle.
    unsafe {
        sqlite_io_result(ffi::sqlite3_initialize())?;
        let vfs = ffi::sqlite3_vfs_find(ptr::null());
        if vfs.is_null() {
            return Err(std::io::Error::other("SQLite has no default VFS"));
        }
        let full_pathname = (*vfs)
            .xFullPathname
            .ok_or_else(|| std::io::Error::other("SQLite VFS has no pathname method"))?;
        let open = (*vfs)
            .xOpen
            .ok_or_else(|| std::io::Error::other("SQLite VFS has no open method"))?;
        let mut full_path = vec![0 as std::ffi::c_char; (*vfs).mxPathname as usize + 1];
        sqlite_io_result(full_pathname(
            vfs,
            path.as_ptr(),
            full_path.len() as i32,
            full_path.as_mut_ptr(),
        ))?;
        let empty = c"";
        let filename = ffi::sqlite3_create_filename(
            full_path.as_ptr(),
            empty.as_ptr(),
            empty.as_ptr(),
            0,
            ptr::null_mut(),
        );
        if filename.is_null() {
            return Err(std::io::Error::other("SQLite filename allocation failed"));
        }
        let file = ffi::sqlite3_malloc((*vfs).szOsFile).cast::<ffi::sqlite3_file>();
        if file.is_null() {
            ffi::sqlite3_free_filename(filename);
            return Err(std::io::Error::other("SQLite VFS file allocation failed"));
        }
        // SQLite allocation supplies the required alignment and szOsFile
        // storage. xOpen sets pMethods even when it returns an error.
        ptr::write_bytes(file.cast::<u8>(), 0, (*vfs).szOsFile as usize);
        let handle = PreflightVfsFile { file, filename };
        let mut open_flags = 0;
        sqlite_io_result(open(
            vfs,
            filename,
            file,
            ffi::SQLITE_OPEN_READONLY | ffi::SQLITE_OPEN_MAIN_DB,
            &mut open_flags,
        ))?;
        if (*file).pMethods.is_null() {
            return Err(std::io::Error::other(
                "SQLite VFS opened without file methods",
            ));
        }
        let read = (*(*file).pMethods)
            .xRead
            .ok_or_else(|| std::io::Error::other("SQLite VFS has no read method"))?;
        let mut header = [0_u8; SQLITE_HEADER_LENGTH];
        sqlite_io_result(read(
            handle.file,
            header.as_mut_ptr().cast(),
            header.len() as i32,
            0,
        ))?;
        Ok(header)
    }
}

struct PreflightVfsFile {
    file: *mut rusqlite::ffi::sqlite3_file,
    filename: rusqlite::ffi::sqlite3_filename,
}

impl Drop for PreflightVfsFile {
    fn drop(&mut self) {
        // SAFETY: the scoped handle owns both SQLite allocations. Its name
        // stays live until xClose, including any failed-open cleanup; no other
        // owner can access the file or free these allocations.
        unsafe {
            if !(*self.file).pMethods.is_null() {
                if let Some(close) = (*(*self.file).pMethods).xClose {
                    close(self.file);
                }
            }
            rusqlite::ffi::sqlite3_free(self.file.cast());
            rusqlite::ffi::sqlite3_free_filename(self.filename);
        }
    }
}

fn sqlite_io_result(code: i32) -> std::io::Result<()> {
    match code {
        rusqlite::ffi::SQLITE_OK => Ok(()),
        rusqlite::ffi::SQLITE_IOERR_SHORT_READ => Err(std::io::ErrorKind::UnexpectedEof.into()),
        code => Err(std::io::Error::other(rusqlite::ffi::Error::new(code))),
    }
}

/// Return page one's user_version from the latest valid committed WAL frame.
fn read_wal_schema_version(path: &Path, main_page_size: Option<usize>) -> Result<Option<i64>> {
    let wal_path = sidecar_path(path, "-wal");
    let mut wal = match std::fs::File::open(&wal_path) {
        Ok(wal) => wal,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut header = [0_u8; WAL_HEADER_LENGTH];
    if wal.read_exact(&mut header).is_err() {
        return Ok(None);
    }
    let checksum_byte_order = match read_be_u32(&header[0..4]) {
        WAL_MAGIC_LITTLE_ENDIAN_CHECKSUMS => ChecksumByteOrder::Little,
        WAL_MAGIC_BIG_ENDIAN_CHECKSUMS => ChecksumByteOrder::Big,
        _ => return Ok(None),
    };
    if read_be_u32(&header[4..8]) != WAL_FORMAT_VERSION {
        return Ok(None);
    }
    let encoded_page_size = read_be_u32(&header[8..12]);
    let page_size = if encoded_page_size == 1 {
        65_536
    } else {
        encoded_page_size as usize
    };
    if !(512..=65_536).contains(&page_size) || !page_size.is_power_of_two() {
        return Ok(None);
    }
    if main_page_size != Some(page_size) {
        return Ok(None);
    }

    let mut rolling_checksum = wal_checksum(checksum_byte_order, &header[..24], [0, 0]);
    if rolling_checksum != [read_be_u32(&header[24..28]), read_be_u32(&header[28..32])] {
        return Ok(None);
    }

    let salts = &header[16..24];
    let frame_size = FRAME_HEADER_LENGTH + page_size;
    let frame_count = wal
        .metadata()?
        .len()
        .saturating_sub(WAL_HEADER_LENGTH as u64)
        / frame_size as u64;
    let mut candidate_page_one = None;
    let mut committed_page_one = None;
    let mut frame = vec![0_u8; frame_size];
    for _ in 0..frame_count {
        wal.read_exact(&mut frame)?;
        let frame_header = &frame[..FRAME_HEADER_LENGTH];
        let page = &frame[FRAME_HEADER_LENGTH..];
        if &frame_header[8..16] != salts || read_be_u32(&frame_header[0..4]) == 0 {
            break;
        }
        let mut frame_checksum =
            wal_checksum(checksum_byte_order, &frame_header[..8], rolling_checksum);
        frame_checksum = wal_checksum(checksum_byte_order, page, frame_checksum);
        if frame_checksum
            != [
                read_be_u32(&frame_header[16..20]),
                read_be_u32(&frame_header[20..24]),
            ]
        {
            break;
        }
        rolling_checksum = frame_checksum;
        if read_be_u32(&frame_header[0..4]) == 1 {
            candidate_page_one = Some(i64::from(read_be_u32(
                &page[USER_VERSION_OFFSET..USER_VERSION_OFFSET + 4],
            )));
        }
        if read_be_u32(&frame_header[4..8]) != 0 {
            committed_page_one = candidate_page_one;
        }
    }
    Ok(committed_page_one)
}

fn sqlite_page_size(header: &[u8; SQLITE_HEADER_LENGTH]) -> Option<usize> {
    let encoded = u16::from_be_bytes([
        header[SQLITE_PAGE_SIZE_OFFSET],
        header[SQLITE_PAGE_SIZE_OFFSET + 1],
    ]);
    let page_size = if encoded == 1 {
        65_536
    } else {
        usize::from(encoded)
    };
    ((512..=65_536).contains(&page_size) && page_size.is_power_of_two()).then_some(page_size)
}

#[derive(Clone, Copy)]
enum ChecksumByteOrder {
    Little,
    Big,
}

fn wal_checksum(order: ChecksumByteOrder, bytes: &[u8], initial: [u32; 2]) -> [u32; 2] {
    debug_assert!(
        bytes.len() >= 8,
        "WAL checksum input must contain at least two words"
    );
    let (pairs, remainder) = bytes.as_chunks::<8>();
    debug_assert!(
        remainder.is_empty(),
        "WAL checksum input must contain complete word pairs"
    );
    let mut checksum = initial;
    for pair in pairs {
        let word = |part: &[u8]| match order {
            ChecksumByteOrder::Little => u32::from_le_bytes([part[0], part[1], part[2], part[3]]),
            ChecksumByteOrder::Big => u32::from_be_bytes([part[0], part[1], part[2], part[3]]),
        };
        checksum[0] = checksum[0]
            .wrapping_add(word(&pair[..4]))
            .wrapping_add(checksum[1]);
        checksum[1] = checksum[1]
            .wrapping_add(word(&pair[4..]))
            .wrapping_add(checksum[0]);
    }
    checksum
}

fn read_be_u32(bytes: &[u8]) -> u32 {
    u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
}

fn sidecar_path(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

#[cfg(test)]
#[path = "wal_preflight_tests.rs"]
mod tests;
