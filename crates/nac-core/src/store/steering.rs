use super::*;

/// Reserved display target used for messages queued to the active orchestrator.
pub const ORCHESTRATOR_STEERING_TARGET: &str = "__orchestrator__";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
    acknowledge_thread_steering_batch_with_connection(&transaction, ids, session_id, dispatch_id)?;
    transaction.commit()?;
    Ok(())
}

pub(super) fn acknowledge_thread_steering_batch_with_connection(
    connection: &Connection,
    ids: &[i64],
    session_id: &str,
    dispatch_id: &str,
) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let delivered_at = now_utc();
    for id in ids {
        let changed = connection.execute(
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
    let pending = if let Some(dispatch_id) = dispatch_id {
        let mut statement = transaction.prepare(&format!(
            "SELECT {RECORD_COLUMNS} FROM thread_steering
             WHERE session_id = ?1 AND dispatch_id = ?2
               AND status IN ('queued', 'claimed') ORDER BY id ASC"
        ))?;
        let mapped = statement.query_map(params![session_id, dispatch_id], row_to_record)?;
        mapped.collect::<std::result::Result<Vec<_>, _>>()?
    } else {
        let mut statement = transaction.prepare(&format!(
            "SELECT {RECORD_COLUMNS} FROM thread_steering
             WHERE session_id = ?1 AND status IN ('queued', 'claimed')
             ORDER BY id ASC"
        ))?;
        let mapped = statement.query_map(params![session_id], row_to_record)?;
        mapped.collect::<std::result::Result<Vec<_>, _>>()?
    };
    if pending.is_empty() {
        transaction.commit()?;
        return Ok(Vec::new());
    }

    let expired_at = now_utc();
    for record in &pending {
        transaction.execute(
            "UPDATE thread_steering SET status = 'expired', expired_at = ?1
             WHERE id = ?2 AND status IN ('queued', 'claimed')",
            params![expired_at, record.id],
        )?;
    }
    transaction.commit()?;
    Ok(pending
        .into_iter()
        .map(|mut record| {
            record.status = "expired".to_string();
            record.expired_at = Some(expired_at.clone());
            record
        })
        .collect())
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
    fn claim_ack_and_expiry_are_exactly_dispatch_scoped() {
        let path = temp_store_path("dispatch_scope");
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
    fn steering_claim_waits_for_a_temporary_writer_lock() {
        let path = temp_store_path("temporary_lock");
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
