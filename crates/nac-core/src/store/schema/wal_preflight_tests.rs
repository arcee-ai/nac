use super::*;

#[cfg(unix)]
const LOCK_PROBE_STORE: &str = "NAC_TEST_PREFLIGHT_LOCK_PROBE_STORE";

#[cfg(unix)]
#[test]
fn preflight_lock_probe_child() {
    let Some(path) = std::env::var_os(LOCK_PROBE_STORE) else {
        return;
    };
    let connection = rusqlite::Connection::open(PathBuf::from(path)).unwrap();
    connection.busy_timeout(std::time::Duration::ZERO).unwrap();
    let error = connection.execute_batch("BEGIN EXCLUSIVE").unwrap_err();
    assert_eq!(
        error.sqlite_error_code(),
        Some(rusqlite::ErrorCode::DatabaseBusy)
    );
}

#[cfg(unix)]
#[test]
fn schema_preflight_preserves_an_existing_sqlite_process_lock() {
    let path = temp_store_path("preflight_process_lock");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch("CREATE TABLE canary(value); PRAGMA user_version=1; BEGIN EXCLUSIVE")
        .unwrap();
    let probe = || {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::schema::wal_preflight::tests::preflight_lock_probe_child",
                "--nocapture",
            ])
            .env(LOCK_PROBE_STORE, &path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "peer obtained the held SQLite lock: {}",
            String::from_utf8_lossy(&output.stdout)
        );
    };
    probe();
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(1));
    probe();
    connection.execute_batch("ROLLBACK").unwrap();
    drop(connection);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
use crate::store::{
    check_readiness, initialize, list_projects, migration_status, StoreMigrationFailure,
    StoreMigrationState, StoreMigrationStatus,
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug)]
enum InvalidWal {
    PageSizeMismatch,
    HeaderChecksum,
    TornFrame,
    FrameChecksum,
    SaltMismatch,
    InvalidFirstPageNumber,
}

impl InvalidWal {
    const ALL: [Self; 6] = [
        Self::PageSizeMismatch,
        Self::HeaderChecksum,
        Self::TornFrame,
        Self::FrameChecksum,
        Self::SaltMismatch,
        Self::InvalidFirstPageNumber,
    ];
}

#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    bytes: Option<Vec<u8>>,
    sha256: Option<[u8; 32]>,
    created: Option<std::time::SystemTime>,
    modified: Option<std::time::SystemTime>,
}

fn snapshot(path: &Path) -> Snapshot {
    match std::fs::read(path) {
        Ok(bytes) => {
            let metadata = std::fs::metadata(path).unwrap();
            Snapshot {
                sha256: Some(Sha256::digest(&bytes).into()),
                bytes: Some(bytes),
                created: metadata.created().ok(),
                modified: metadata.modified().ok(),
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Snapshot {
            bytes: None,
            sha256: None,
            created: None,
            modified: None,
        },
        Err(error) => panic!("failed to snapshot {}: {error}", path.display()),
    }
}

fn snapshots(path: &Path) -> [Snapshot; 3] {
    [
        snapshot(path),
        snapshot(&sidecar_path(path, "-wal")),
        snapshot(&sidecar_path(path, "-shm")),
    ]
}

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_wal_preflight_{label}_{unique}"))
        .join("store.db")
}

fn wal_header(page_size: u32, salts: [u8; 8], order: ChecksumByteOrder) -> (Vec<u8>, [u32; 2]) {
    let mut header = vec![0_u8; WAL_HEADER_LENGTH];
    let magic = match order {
        ChecksumByteOrder::Little => WAL_MAGIC_LITTLE_ENDIAN_CHECKSUMS,
        ChecksumByteOrder::Big => WAL_MAGIC_BIG_ENDIAN_CHECKSUMS,
    };
    header[0..4].copy_from_slice(&magic.to_be_bytes());
    header[4..8].copy_from_slice(&WAL_FORMAT_VERSION.to_be_bytes());
    header[8..12].copy_from_slice(&page_size.to_be_bytes());
    header[16..24].copy_from_slice(&salts);
    let checksum = wal_checksum(order, &header[..24], [0, 0]);
    header[24..28].copy_from_slice(&checksum[0].to_be_bytes());
    header[28..32].copy_from_slice(&checksum[1].to_be_bytes());
    (header, checksum)
}

fn wal_frame(
    page_number: u32,
    committed_pages: u32,
    salts: [u8; 8],
    page: &[u8],
    rolling: [u32; 2],
    order: ChecksumByteOrder,
) -> (Vec<u8>, [u32; 2]) {
    let mut frame = vec![0_u8; FRAME_HEADER_LENGTH + page.len()];
    frame[0..4].copy_from_slice(&page_number.to_be_bytes());
    frame[4..8].copy_from_slice(&committed_pages.to_be_bytes());
    frame[8..16].copy_from_slice(&salts);
    frame[FRAME_HEADER_LENGTH..].copy_from_slice(page);
    let checksum = wal_checksum(order, &frame[..8], rolling);
    let checksum = wal_checksum(order, &frame[FRAME_HEADER_LENGTH..], checksum);
    frame[16..20].copy_from_slice(&checksum[0].to_be_bytes());
    frame[20..24].copy_from_slice(&checksum[1].to_be_bytes());
    (frame, checksum)
}

fn prepare_future_main_with_invalid_wal(path: &Path, invalid: InvalidWal) -> i64 {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let future_version = super::super::STORE_SCHEMA_VERSION + 1;
    let connection = Connection::open(path).unwrap();
    connection
        .execute_batch(
            "PRAGMA page_size = 4096;
             PRAGMA journal_mode = DELETE;
             CREATE TABLE future_sentinel (value TEXT NOT NULL);
             INSERT INTO future_sentinel VALUES ('future-data-canary');",
        )
        .unwrap();
    connection
        .pragma_update(None, "user_version", future_version)
        .unwrap();
    let page_size: u32 = connection
        .pragma_query_value(None, "page_size", |row| row.get(0))
        .unwrap();
    let page_count: u32 = connection
        .pragma_query_value(None, "page_count", |row| row.get(0))
        .unwrap();
    drop(connection);

    let wal_page_size = if matches!(invalid, InvalidWal::PageSizeMismatch) {
        512
    } else {
        page_size
    };
    let mut page_one = std::fs::read(path).unwrap()[..wal_page_size as usize].to_vec();
    page_one[USER_VERSION_OFFSET..USER_VERSION_OFFSET + 4]
        .copy_from_slice(&(super::super::STORE_SCHEMA_VERSION as u32).to_be_bytes());
    let salts = [0x41, 0x4c, 0x4c, 0x2d, 0x33, 0x39, 0x00, 0x01];
    let order = ChecksumByteOrder::Little;
    let (mut wal, rolling) = wal_header(wal_page_size, salts, order);
    let (mut current_frame, current_checksum) =
        wal_frame(1, page_count, salts, &page_one, rolling, order);

    match invalid {
        InvalidWal::PageSizeMismatch => wal.extend_from_slice(&current_frame),
        InvalidWal::HeaderChecksum => {
            wal[24] ^= 0x80;
            wal.extend_from_slice(&current_frame);
        }
        InvalidWal::TornFrame => wal.extend_from_slice(&current_frame[..current_frame.len() / 2]),
        InvalidWal::FrameChecksum => {
            current_frame[16] ^= 0x80;
            wal.extend_from_slice(&current_frame);
        }
        InvalidWal::SaltMismatch => {
            current_frame[8] ^= 0x80;
            wal.extend_from_slice(&current_frame);
        }
        InvalidWal::InvalidFirstPageNumber => {
            let (invalid_first, invalid_checksum) =
                wal_frame(0, 0, salts, &page_one, rolling, order);
            let (later_current, _) =
                wal_frame(1, page_count, salts, &page_one, invalid_checksum, order);
            wal.extend_from_slice(&invalid_first);
            wal.extend_from_slice(&later_current);
            assert_ne!(invalid_checksum, current_checksum);
        }
    }

    std::fs::write(sidecar_path(path, "-wal"), wal).unwrap();
    std::fs::write(sidecar_path(path, "-shm"), b"NAC invalid WAL SHM canary").unwrap();
    future_version
}

fn assert_future_main_contents(path: &Path, future_version: i64) {
    std::fs::remove_file(sidecar_path(path, "-wal")).unwrap();
    std::fs::remove_file(sidecar_path(path, "-shm")).unwrap();
    let connection = Connection::open(path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        future_version
    );
    assert_eq!(
        connection
            .query_row("SELECT value FROM future_sentinel", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap(),
        "future-data-canary"
    );
}

#[test]
fn valid_wal_checksums_support_both_sqlite_byte_orders() {
    for order in [ChecksumByteOrder::Little, ChecksumByteOrder::Big] {
        let path = temp_store_path("valid_checksum_order");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut main = [0_u8; SQLITE_HEADER_LENGTH];
        main[..SQLITE_MAGIC.len()].copy_from_slice(SQLITE_MAGIC);
        main[SQLITE_PAGE_SIZE_OFFSET..SQLITE_PAGE_SIZE_OFFSET + 2]
            .copy_from_slice(&4096_u16.to_be_bytes());
        std::fs::write(&path, main).unwrap();

        let page_size = 4096_u32;
        let salts = [1, 2, 3, 4, 5, 6, 7, 8];
        let (mut wal, rolling) = wal_header(page_size, salts, order);
        let mut page_one = vec![0_u8; page_size as usize];
        let future = super::super::STORE_SCHEMA_VERSION as u32 + 1;
        page_one[USER_VERSION_OFFSET..USER_VERSION_OFFSET + 4]
            .copy_from_slice(&future.to_be_bytes());
        let (frame, _) = wal_frame(1, 1, salts, &page_one, rolling, order);
        wal.extend_from_slice(&frame);
        std::fs::write(sidecar_path(&path, "-wal"), wal).unwrap();

        assert_eq!(
            read_schema_version_header(&path).unwrap(),
            Some(i64::from(future))
        );
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

#[test]
fn invalid_wal_cannot_mask_future_main_schema_or_mutate_any_file() {
    for invalid in InvalidWal::ALL {
        for action in ["initialize", "normal-open", "migration-status", "readiness"] {
            let path = temp_store_path(&format!("{invalid:?}_{action}"));
            let future_version = prepare_future_main_with_invalid_wal(&path, invalid);
            let before = snapshots(&path);

            match action {
                "initialize" => {
                    assert!(initialize(&path)
                        .unwrap_err()
                        .to_string()
                        .contains(&format!(
                            "unsupported store schema version {future_version}"
                        )))
                }
                "normal-open" => {
                    assert!(list_projects(&path)
                        .unwrap_err()
                        .to_string()
                        .contains(&format!(
                            "unsupported store schema version {future_version}"
                        )))
                }
                "migration-status" => assert_eq!(
                    migration_status(&path),
                    StoreMigrationStatus {
                        supported_schema_version: super::super::STORE_SCHEMA_VERSION,
                        opened_schema_version: Some(future_version),
                        state: StoreMigrationState::Failed,
                        failure: Some(StoreMigrationFailure::FutureSchema),
                    }
                ),
                "readiness" => {
                    assert!(check_readiness(&path)
                        .unwrap_err()
                        .to_string()
                        .contains(&format!(
                            "unsupported store schema version {future_version}"
                        )))
                }
                _ => unreachable!(),
            }

            assert_eq!(
                snapshots(&path),
                before,
                "{invalid:?} {action} mutated files"
            );
            assert_future_main_contents(&path, future_version);
            std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        }
    }
}

fn write_main_header(path: &Path, page_size: u16, user_version: u32) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut main = [0_u8; SQLITE_HEADER_LENGTH];
    main[..SQLITE_MAGIC.len()].copy_from_slice(SQLITE_MAGIC);
    main[SQLITE_PAGE_SIZE_OFFSET..SQLITE_PAGE_SIZE_OFFSET + 2]
        .copy_from_slice(&page_size.to_be_bytes());
    main[USER_VERSION_OFFSET..USER_VERSION_OFFSET + 4].copy_from_slice(&user_version.to_be_bytes());
    std::fs::write(path, main).unwrap();
}

/// One WAL generation built frame by frame, as SQLite appends it.
struct WalImage {
    bytes: Vec<u8>,
    salts: [u8; 8],
    rolling: [u32; 2],
    page_size: u32,
}

impl WalImage {
    fn new(page_size: u32, salts: [u8; 8]) -> Self {
        let (bytes, rolling) = wal_header(page_size, salts, ChecksumByteOrder::Little);
        Self {
            bytes,
            salts,
            rolling,
            page_size,
        }
    }

    fn push(&mut self, page_number: u32, commit: bool, user_version: Option<u32>) {
        let mut page = vec![0_u8; self.page_size as usize];
        if let Some(version) = user_version {
            page[USER_VERSION_OFFSET..USER_VERSION_OFFSET + 4]
                .copy_from_slice(&version.to_be_bytes());
        }
        let (frame, rolling) = wal_frame(
            page_number,
            u32::from(commit),
            self.salts,
            &page,
            self.rolling,
            ChecksumByteOrder::Little,
        );
        self.bytes.extend_from_slice(&frame);
        self.rolling = rolling;
    }

    fn write(&self, path: &Path) {
        std::fs::write(sidecar_path(path, "-wal"), &self.bytes).unwrap();
    }
}

fn verified_end(path: &Path) -> Option<u64> {
    verified_wals()
        .get(&sidecar_path(path, "-wal"))
        .map(|verified| verified.end)
}

fn full_scan(path: &Path) -> Option<i64> {
    verified_wals().remove(&sidecar_path(path, "-wal"));
    read_schema_version_header(path).unwrap()
}

#[test]
fn preflight_resumes_after_verified_commits_and_agrees_with_a_full_scan() {
    let path = temp_store_path("resume");
    write_main_header(&path, 4096, 7);
    let frame = (FRAME_HEADER_LENGTH + 4096) as u64;
    let header = WAL_HEADER_LENGTH as u64;
    let mut wal = WalImage::new(4096, [9, 8, 7, 6, 5, 4, 3, 2]);
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(7));

    wal.push(1, true, Some(10));
    wal.write(&path);
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(10));
    assert_eq!(verified_end(&path), Some(header + frame));

    // A commit without page one keeps it; an uncommitted page one is pending.
    wal.push(2, true, None);
    wal.push(1, false, Some(11));
    wal.write(&path);
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(10));
    assert_eq!(verified_end(&path), Some(header + 2 * frame));

    // Its commit lands later; the resumed scan starts before the pending frame.
    wal.push(3, true, None);
    wal.write(&path);
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(11));
    assert_eq!(verified_end(&path), Some(header + 4 * frame));

    // A torn frame after the verified prefix ends the scan exactly as before.
    let mut torn = wal.bytes.clone();
    let mut extra = WalImage::new(4096, [9, 8, 7, 6, 5, 4, 3, 2]);
    extra.rolling = wal.rolling;
    extra.bytes.clear();
    extra.push(1, true, Some(99));
    extra.bytes[FRAME_HEADER_LENGTH + 100] ^= 0x01;
    torn.extend_from_slice(&extra.bytes);
    std::fs::write(sidecar_path(&path, "-wal"), torn).unwrap();
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(11));
    assert_eq!(full_scan(&path), Some(11));
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn a_restarted_or_truncated_wal_is_scanned_from_its_new_header() {
    let path = temp_store_path("restart");
    write_main_header(&path, 4096, 7);
    let mut first = WalImage::new(4096, [1, 1, 1, 1, 1, 1, 1, 1]);
    for _ in 0..3 {
        first.push(2, true, None);
    }
    first.push(1, true, Some(20));
    first.write(&path);
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(20));

    // A restart rewrites the header with new salts over the old frames.
    let mut restarted = WalImage::new(4096, [2, 1, 1, 1, 9, 9, 9, 9]);
    restarted.push(1, true, Some(21));
    let mut bytes = restarted.bytes.clone();
    bytes.extend_from_slice(&first.bytes[bytes.len()..]);
    std::fs::write(sidecar_path(&path, "-wal"), &bytes).unwrap();
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(21));
    assert_eq!(full_scan(&path), Some(21));

    // A shorter log with no commits of its own falls back to the main file.
    WalImage::new(4096, [3, 1, 1, 1, 9, 9, 9, 9]).write(&path);
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(7));
    std::fs::write(sidecar_path(&path, "-wal"), b"").unwrap();
    assert_eq!(read_schema_version_header(&path).unwrap(), Some(7));
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
