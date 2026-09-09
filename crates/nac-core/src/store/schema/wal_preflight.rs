use anyhow::Result;
use std::io::Read;
use std::path::{Path, PathBuf};

const SQLITE_HEADER_LENGTH: usize = 64;
const USER_VERSION_OFFSET: usize = 60;
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const WAL_HEADER_LENGTH: usize = 32;
const FRAME_HEADER_LENGTH: usize = 24;
const WAL_MAGIC_LITTLE_ENDIAN_CHECKSUMS: u32 = 0x377f_0682;
const WAL_MAGIC_BIG_ENDIAN_CHECKSUMS: u32 = 0x377f_0683;
const WAL_FORMAT_VERSION: u32 = 3_007_000;

/// Read page one's effective user_version without opening SQLite. Invalid or
/// incomplete WAL content is ignored exactly as SQLite recovery ignores it, so
/// it cannot mask a future main-database schema and cause a mutating open.
pub(super) fn read_schema_version_header(path: &Path) -> Result<Option<i64>> {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let mut header = [0_u8; SQLITE_HEADER_LENGTH];
    match file.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    if &header[..SQLITE_MAGIC.len()] != SQLITE_MAGIC {
        return Ok(None);
    }
    let main_version = read_be_u32(&header[USER_VERSION_OFFSET..USER_VERSION_OFFSET + 4]);
    Ok(Some(
        read_wal_schema_version(path)?.unwrap_or_else(|| i64::from(main_version)),
    ))
}

/// Return page one's user_version from the latest valid committed WAL frame.
fn read_wal_schema_version(path: &Path) -> Result<Option<i64>> {
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
