use super::*;

/// Reserved display target used for messages queued to the active orchestrator.
pub const ORCHESTRATOR_STEERING_TARGET: &str = "__orchestrator__";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ThreadSteeringRecord {
    pub id: i64,
    pub session_id: String,
    pub thread_name: String,
    pub dispatch_id: String,
    pub instruction: String,
    pub status: String,
    pub created_at: String,
    pub claimed_at: Option<String>,
    pub delivered_at: Option<String>,
    pub expired_at: Option<String>,
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ThreadSteeringRecord> {
    Ok(ThreadSteeringRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        thread_name: row.get(2)?,
        dispatch_id: row.get(3)?,
        instruction: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
        claimed_at: row.get(7)?,
        delivered_at: row.get(8)?,
        expired_at: row.get(9)?,
    })
}

const RECORD_COLUMNS: &str =
    "id, session_id, thread_name, dispatch_id, instruction, status, created_at, \
     claimed_at, delivered_at, expired_at";

pub fn queue_thread_steering(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    dispatch_id: &str,
    instruction: &str,
) -> Result<ThreadSteeringRecord> {
    let instruction = instruction.trim();
    if session_id.trim().is_empty() {
        return Err(anyhow!("session id is empty"));
    }
    if thread_name.trim().is_empty() {
        return Err(anyhow!("thread name is empty"));
    }
    if dispatch_id.trim().is_empty() {
        return Err(anyhow!("dispatch id is empty"));
    }
    if instruction.is_empty() {
        return Err(anyhow!("steering instruction is empty"));
    }

    let conn = open_runtime_connection(path)?;
    let created_at = now_utc();
    conn.execute(
        "INSERT INTO thread_steering
         (session_id, thread_name, dispatch_id, instruction, status, created_at)
         VALUES (?1, ?2, ?3, ?4, 'queued', ?5)",
        params![
            session_id,
            thread_name,
            dispatch_id,
            instruction,
            created_at
        ],
    )?;
    Ok(ThreadSteeringRecord {
        id: conn.last_insert_rowid(),
        session_id: session_id.to_string(),
        thread_name: thread_name.to_string(),
        dispatch_id: dispatch_id.to_string(),
        instruction: instruction.to_string(),
        status: "queued".to_string(),
        created_at,
        claimed_at: None,
        delivered_at: None,
        expired_at: None,
    })
}

pub fn claim_thread_steering(
    path: &Path,
    session_id: &str,
    dispatch_id: &str,
) -> Result<Vec<ThreadSteeringRecord>> {
    retry_busy(|| claim_thread_steering_once(path, session_id, dispatch_id))
}

fn claim_thread_steering_once(
    path: &Path,
    session_id: &str,
    dispatch_id: &str,
) -> Result<Vec<ThreadSteeringRecord>> {
    let mut conn = open_runtime_connection(path)?;
    let transaction = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    transaction.execute(
        "UPDATE thread_steering
         SET status = 'claimed', claimed_at = ?1
         WHERE session_id = ?2 AND dispatch_id = ?3 AND status = 'queued'",
        params![now_utc(), session_id, dispatch_id],
    )?;
    let records = {
        let mut statement = transaction.prepare(&format!(
            "SELECT {RECORD_COLUMNS} FROM thread_steering
             WHERE session_id = ?1 AND dispatch_id = ?2 AND status = 'claimed'
             ORDER BY id ASC"
        ))?;
        let mapped = statement.query_map(params![session_id, dispatch_id], row_to_record)?;
        mapped.collect::<std::result::Result<Vec<_>, _>>()?
    };
    transaction.commit()?;
    Ok(records)
}

pub fn acknowledge_thread_steering_batch(
    path: &Path,
    ids: &[i64],
    session_id: &str,
    dispatch_id: &str,
) -> Result<()> {
    retry_busy(|| acknowledge_thread_steering_batch_once(path, ids, session_id, dispatch_id))
}

fn acknowledge_thread_steering_batch_once(
    path: &Path,
    ids: &[i64],
    session_id: &str,
    dispatch_id: &str,
) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut conn = open_runtime_connection(path)?;
    let transaction = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let delivered_at = now_utc();
    for id in ids {
        let changed = transaction.execute(
            "UPDATE thread_steering
             SET status = 'delivered', delivered_at = ?1
             WHERE id = ?2 AND session_id = ?3 AND dispatch_id = ?4 AND status = 'claimed'",
            params![delivered_at, id, session_id, dispatch_id],
        )?;
        if changed != 1 {
            return Err(anyhow!(
                "steering {id} is not claimed by dispatch '{dispatch_id}'"
            ));
        }
    }
    transaction.commit()?;
    Ok(())
}

pub fn expire_thread_steering(
    path: &Path,
    session_id: &str,
    dispatch_id: &str,
) -> Result<Vec<ThreadSteeringRecord>> {
    retry_busy(|| expire_thread_steering_once(path, session_id, Some(dispatch_id)))
}

pub fn expire_session_steering(path: &Path, session_id: &str) -> Result<Vec<ThreadSteeringRecord>> {
    retry_busy(|| expire_thread_steering_once(path, session_id, None))
}

fn expire_thread_steering_once(
    path: &Path,
    session_id: &str,
    dispatch_id: Option<&str>,
) -> Result<Vec<ThreadSteeringRecord>> {
    let mut conn = open_runtime_connection(path)?;
    let transaction = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let expired_at = now_utc();
    let mut records = {
        let mut statement = transaction.prepare(&format!(
            "UPDATE thread_steering
             SET status = 'expired', expired_at = ?1
             WHERE session_id = ?2 AND (?3 IS NULL OR dispatch_id = ?3)
               AND status IN ('queued', 'claimed')
             RETURNING {RECORD_COLUMNS}"
        ))?;
        let mapped =
            statement.query_map(params![expired_at, session_id, dispatch_id], row_to_record)?;
        mapped.collect::<std::result::Result<Vec<_>, _>>()?
    };
    transaction.commit()?;
    records.sort_unstable_by_key(|record| record.id);
    Ok(records)
}

fn retry_busy<T>(mut operation: impl FnMut() -> Result<T>) -> Result<T> {
    const RETRY_DELAYS: [std::time::Duration; 4] = [
        std::time::Duration::from_millis(20),
        std::time::Duration::from_millis(50),
        std::time::Duration::from_millis(100),
        std::time::Duration::from_millis(200),
    ];
    for delay in RETRY_DELAYS {
        match operation() {
            Err(error) if is_sqlite_busy(&error) => std::thread::sleep(delay),
            result => return result,
        }
    }
    operation()
}

#[cfg(test)]
pub fn list_thread_steering(path: &Path, session_id: &str) -> Result<Vec<ThreadSteeringRecord>> {
    let conn = open_runtime_connection(path)?;
    list_thread_steering_with_connection(&conn, session_id)
}

pub(crate) fn list_thread_steering_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ThreadSteeringRecord>> {
    let mut statement = conn.prepare(&format!(
        "SELECT {RECORD_COLUMNS} FROM (
             SELECT {RECORD_COLUMNS} FROM thread_steering
             WHERE session_id = ?1 ORDER BY id DESC LIMIT 512
         ) ORDER BY id ASC"
    ))?;
    let mapped = statement.query_map(params![session_id], row_to_record)?;
    let records = mapped.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claim_ack_and_expiry_are_exactly_dispatch_scoped() {
        let path = crate::test_utils::temp_store_path("dispatch_scope");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        let first = queue_thread_steering(&path, "session", "impl", "dispatch-a", "first").unwrap();
        let second =
            queue_thread_steering(&path, "session", "impl", "dispatch-a", "second").unwrap();
        let reused =
            queue_thread_steering(&path, "session", "impl", "dispatch-b", "reused").unwrap();

        let claimed = claim_thread_steering(&path, "session", "dispatch-a").unwrap();
        assert_eq!(
            claimed.iter().map(|record| record.id).collect::<Vec<_>>(),
            vec![first.id, second.id]
        );
        assert!(claimed.iter().all(|record| {
            record.status == "claimed"
                && record.claimed_at.is_some()
                && record.delivered_at.is_none()
        }));
        assert_eq!(
            claim_thread_steering(&path, "session", "dispatch-a").unwrap(),
            claimed,
            "an interrupted claimant must recover its existing claims"
        );
        assert!(
            acknowledge_thread_steering_batch(&path, &[first.id], "session", "dispatch-b").is_err()
        );
        acknowledge_thread_steering_batch(&path, &[first.id], "session", "dispatch-a").unwrap();
        let delivered = list_thread_steering(&path, "session")
            .unwrap()
            .into_iter()
            .find(|record| record.id == first.id)
            .unwrap();
        assert_eq!(delivered.status, "delivered");
        assert!(delivered.delivered_at.is_some());

        let expired = expire_thread_steering(&path, "session", "dispatch-a").unwrap();
        assert_eq!(
            expired.iter().map(|record| record.id).collect::<Vec<_>>(),
            vec![second.id]
        );
        assert_eq!(
            list_thread_steering(&path, "session")
                .unwrap()
                .into_iter()
                .find(|record| record.id == reused.id)
                .unwrap()
                .status,
            "queued"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn session_expiry_returns_ordered_final_records_and_persists_once() {
        let path = crate::test_utils::temp_store_path("session_expiry_set_update");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        crate::store::insert_test_session(&path, "other-session");
        let first = queue_thread_steering(&path, "session", "impl", "dispatch-a", "first").unwrap();
        let claimed =
            queue_thread_steering(&path, "session", "impl", "dispatch-b", "claimed").unwrap();
        let delivered =
            queue_thread_steering(&path, "session", "impl", "dispatch-b", "delivered").unwrap();
        let already_expired =
            queue_thread_steering(&path, "session", "impl", "dispatch-c", "expired").unwrap();
        let other =
            queue_thread_steering(&path, "other-session", "impl", "dispatch-a", "other").unwrap();
        claim_thread_steering(&path, "session", "dispatch-b").unwrap();
        acknowledge_thread_steering_batch(&path, &[delivered.id], "session", "dispatch-b").unwrap();
        expire_thread_steering(&path, "session", "dispatch-c").unwrap();

        let expired = expire_session_steering(&path, "session").unwrap();
        assert_eq!(
            expired.iter().map(|record| record.id).collect::<Vec<_>>(),
            vec![first.id, claimed.id]
        );
        assert!(expired
            .iter()
            .all(|record| record.status == "expired" && record.expired_at.is_some()));
        assert!(expire_session_steering(&path, "session")
            .unwrap()
            .is_empty());

        let persisted = list_thread_steering(&path, "session").unwrap();
        assert_eq!(
            persisted
                .iter()
                .find(|record| record.id == delivered.id)
                .unwrap()
                .status,
            "delivered"
        );
        assert_eq!(
            persisted
                .iter()
                .find(|record| record.id == already_expired.id)
                .unwrap()
                .status,
            "expired"
        );
        assert_eq!(
            list_thread_steering(&path, "other-session").unwrap()[0].id,
            other.id
        );
        assert_eq!(
            list_thread_steering(&path, "other-session").unwrap()[0].status,
            "queued"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn session_expiry_rolls_back_the_set_on_update_failure() {
        let path = crate::test_utils::temp_store_path("session_expiry_rollback");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        queue_thread_steering(&path, "session", "impl", "dispatch", "first").unwrap();
        queue_thread_steering(&path, "session", "impl", "dispatch", "blocked").unwrap();
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER reject_blocked_expiry BEFORE UPDATE ON thread_steering
             WHEN NEW.status = 'expired' AND OLD.instruction = 'blocked'
             BEGIN SELECT RAISE(ABORT, 'blocked expiry'); END;",
        )
        .unwrap();

        assert!(expire_session_steering(&path, "session").is_err());
        assert!(list_thread_steering(&path, "session")
            .unwrap()
            .iter()
            .all(|record| record.status == "queued" && record.expired_at.is_none()));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn steering_expiry_waits_for_a_temporary_writer_lock() {
        let path = crate::test_utils::temp_store_path("expiry_temporary_lock");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        queue_thread_steering(&path, "session", "impl", "dispatch", "keep going").unwrap();

        let lock = rusqlite::Connection::open(&path).unwrap();
        lock.execute_batch("BEGIN IMMEDIATE").unwrap();
        let expiry_path = path.clone();
        let expiry =
            std::thread::spawn(move || expire_thread_steering(&expiry_path, "session", "dispatch"));
        std::thread::sleep(std::time::Duration::from_millis(50));
        lock.execute_batch("COMMIT").unwrap();

        let expired = expiry.join().unwrap().unwrap();
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].status, "expired");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn steering_claim_waits_for_a_temporary_writer_lock() {
        let path = crate::test_utils::temp_store_path("temporary_lock");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        queue_thread_steering(&path, "session", "impl", "dispatch", "keep going").unwrap();

        let lock = rusqlite::Connection::open(&path).unwrap();
        lock.execute_batch("BEGIN IMMEDIATE").unwrap();
        let claim_path = path.clone();
        let claim =
            std::thread::spawn(move || claim_thread_steering(&claim_path, "session", "dispatch"));
        std::thread::sleep(std::time::Duration::from_millis(50));
        lock.execute_batch("COMMIT").unwrap();

        let claimed = claim.join().unwrap().unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].status, "claimed");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
