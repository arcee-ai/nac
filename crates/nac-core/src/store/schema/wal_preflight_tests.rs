use super::*;
use crate::store::{
    check_readiness, initialize, list_projects, migration_status, StoreMigrationFailure,
    StoreMigrationState, StoreMigrationStatus,
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug)]
enum InvalidWal {
    HeaderChecksum,
    TornFrame,
    FrameChecksum,
    SaltMismatch,
    InvalidFirstPageNumber,
}

impl InvalidWal {
    const ALL: [Self; 5] = [
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
            "PRAGMA journal_mode = DELETE;
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

    let mut page_one = std::fs::read(path).unwrap()[..page_size as usize].to_vec();
    page_one[USER_VERSION_OFFSET..USER_VERSION_OFFSET + 4]
        .copy_from_slice(&(super::super::STORE_SCHEMA_VERSION as u32).to_be_bytes());
    let salts = [0x41, 0x4c, 0x4c, 0x2d, 0x33, 0x39, 0x00, 0x01];
    let order = ChecksumByteOrder::Little;
    let (mut wal, rolling) = wal_header(page_size, salts, order);
    let (mut current_frame, current_checksum) =
        wal_frame(1, page_count, salts, &page_one, rolling, order);

    match invalid {
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
