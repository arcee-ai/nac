use super::*;

/// Reserved steering target used for messages queued to the active
/// orchestrator rather than to one of its worker threads.
pub const ORCHESTRATOR_STEERING_TARGET: &str = "__orchestrator__";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ThreadSteeringRecord {
    pub id: i64,
    pub session_id: String,
    pub thread_name: String,
    pub instruction: String,
    pub status: String,
    pub created_at: String,
    pub delivered_at: Option<String>,
    pub expired_at: Option<String>,
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ThreadSteeringRecord> {
    Ok(ThreadSteeringRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        thread_name: row.get(2)?,
        instruction: row.get(3)?,
        status: row.get(4)?,
        created_at: row.get(5)?,
        delivered_at: row.get(6)?,
        expired_at: row.get(7)?,
    })
}

pub fn queue_thread_steering(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    instruction: &str,
) -> Result<ThreadSteeringRecord> {
    let instruction = instruction.trim();
    if session_id.trim().is_empty() {
        return Err(anyhow!("session id is empty"));
    }
    if thread_name.trim().is_empty() {
        return Err(anyhow!("thread name is empty"));
    }
    if instruction.is_empty() {
        return Err(anyhow!("steering instruction is empty"));
    }

    let conn = open_runtime_connection(path)?;
    let created_at = now_utc();
    conn.execute(
        "INSERT INTO thread_steering
         (session_id, thread_name, instruction, status, created_at)
         VALUES (?1, ?2, ?3, 'queued', ?4)",
        params![session_id, thread_name, instruction, created_at],
    )?;
    let id = conn.last_insert_rowid();
    Ok(ThreadSteeringRecord {
        id,
        session_id: session_id.to_string(),
        thread_name: thread_name.to_string(),
        instruction: instruction.to_string(),
        status: "queued".to_string(),
        created_at,
        delivered_at: None,
        expired_at: None,
    })
}

pub fn claim_thread_steering(
    path: &Path,
    session_id: &str,
    thread_name: &str,
) -> Result<Vec<ThreadSteeringRecord>> {
    transition_queued(path, session_id, thread_name, "delivered")
}

pub fn expire_thread_steering(
    path: &Path,
    session_id: &str,
    thread_name: &str,
) -> Result<Vec<ThreadSteeringRecord>> {
    transition_queued(path, session_id, thread_name, "expired")
}

fn transition_queued(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    next_status: &str,
) -> Result<Vec<ThreadSteeringRecord>> {
    const RETRY_DELAYS: [std::time::Duration; 4] = [
        std::time::Duration::from_millis(20),
        std::time::Duration::from_millis(50),
        std::time::Duration::from_millis(100),
        std::time::Duration::from_millis(200),
    ];

    for delay in RETRY_DELAYS {
        match transition_queued_once(path, session_id, thread_name, next_status) {
            Err(error) if is_sqlite_busy(&error) => std::thread::sleep(delay),
            result => return result,
        }
    }
    transition_queued_once(path, session_id, thread_name, next_status)
}

fn transition_queued_once(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    next_status: &str,
) -> Result<Vec<ThreadSteeringRecord>> {
    debug_assert!(matches!(next_status, "delivered" | "expired"));
    let mut conn = open_runtime_connection(path)?;
    let transaction = conn.transaction()?;
    let pending = {
        let mut statement = transaction.prepare(
            "SELECT id, session_id, thread_name, instruction, status, created_at,
                    delivered_at, expired_at
             FROM thread_steering
             WHERE session_id = ?1 AND thread_name = ?2 AND status = 'queued'
             ORDER BY id ASC",
        )?;
        let records = statement
            .query_map(params![session_id, thread_name], row_to_record)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        records
    };

    if pending.is_empty() {
        transaction.commit()?;
        return Ok(Vec::new());
    }

    let transitioned_at = now_utc();
    let timestamp_column = if next_status == "delivered" {
        "delivered_at"
    } else {
        "expired_at"
    };
    let sql = format!(
        "UPDATE thread_steering
         SET status = ?1, {timestamp_column} = ?2
         WHERE id = ?3 AND status = 'queued'"
    );
    for record in &pending {
        transaction.execute(&sql, params![next_status, transitioned_at, record.id])?;
    }
    transaction.commit()?;

    Ok(pending
        .into_iter()
        .map(|mut record| {
            record.status = next_status.to_string();
            if next_status == "delivered" {
                record.delivered_at = Some(transitioned_at.clone());
            } else {
                record.expired_at = Some(transitioned_at.clone());
            }
            record
        })
        .collect())
}

pub fn list_thread_steering(path: &Path, session_id: &str) -> Result<Vec<ThreadSteeringRecord>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn.prepare(
        "SELECT id, session_id, thread_name, instruction, status, created_at,
                delivered_at, expired_at
         FROM (
             SELECT id, session_id, thread_name, instruction, status, created_at,
                    delivered_at, expired_at
             FROM thread_steering
             WHERE session_id = ?1
             ORDER BY id DESC
             LIMIT 512
         )
         ORDER BY id ASC",
    )?;
    let records = statement
        .query_map(params![session_id], row_to_record)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_steering_test_{label}_{unique}"))
            .join("store.db")
    }

    #[test]
    fn queued_instructions_are_claimed_once_in_order() {
        let path = temp_store_path("claim");
        initialize(&path).unwrap();
        let first = queue_thread_steering(&path, "session", "impl", "first").unwrap();
        let second = queue_thread_steering(&path, "session", "impl", "second").unwrap();
        queue_thread_steering(&path, "session", "review", "other").unwrap();

        let claimed = claim_thread_steering(&path, "session", "impl").unwrap();
        assert_eq!(
            claimed.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![first.id, second.id]
        );
        assert!(claimed.iter().all(|item| item.status == "delivered"));
        assert!(claim_thread_steering(&path, "session", "impl")
            .unwrap()
            .is_empty());
        assert_eq!(
            claim_thread_steering(&path, "session", "review")
                .unwrap()
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn pending_instructions_can_be_expired_without_touching_delivered_rows() {
        let path = temp_store_path("expire");
        initialize(&path).unwrap();
        queue_thread_steering(&path, "session", "impl", "delivered").unwrap();
        claim_thread_steering(&path, "session", "impl").unwrap();
        let pending = queue_thread_steering(&path, "session", "impl", "too late").unwrap();

        let expired = expire_thread_steering(&path, "session", "impl").unwrap();
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].id, pending.id);
        assert_eq!(expired[0].status, "expired");
        let all = list_thread_steering(&path, "session").unwrap();
        assert_eq!(all[0].status, "delivered");
        assert_eq!(all[1].status, "expired");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn steering_claim_waits_for_a_temporary_writer_lock() {
        let path = temp_store_path("temporary_lock");
        initialize(&path).unwrap();
        queue_thread_steering(&path, "session", "impl", "keep going").unwrap();

        let lock = rusqlite::Connection::open(&path).unwrap();
        lock.execute_batch("BEGIN IMMEDIATE").unwrap();
        let claim_path = path.clone();
        let claim = std::thread::spawn(move || {
            claim_thread_steering(&claim_path, "session", "impl")
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        lock.execute_batch("COMMIT").unwrap();

        let claimed = claim.join().unwrap().unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].status, "delivered");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
