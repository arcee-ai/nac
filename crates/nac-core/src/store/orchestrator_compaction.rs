use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NewOrchestratorCompactionCheckpoint {
    pub session_id: String,
    pub previous_checkpoint_id: Option<i64>,
    /// Exact synthetic user-message content, including its wrapper.
    pub summary: String,
    pub tail_start_message_index: usize,
    pub source_prefix_sha256: [u8; 32],
    pub system_policy_sha256: [u8; 32],
    pub prompt_policy_version: u32,
    pub old_context_estimate: u64,
    pub summary_prompt_tokens: Option<u64>,
    pub summary_completion_tokens: Option<u64>,
    pub new_context_estimate: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OrchestratorCompactionCheckpoint {
    pub id: i64,
    pub session_id: String,
    pub previous_checkpoint_id: Option<i64>,
    /// Exact synthetic user-message content, including its wrapper.
    pub summary: String,
    pub tail_start_message_index: usize,
    pub source_prefix_sha256: [u8; 32],
    pub system_policy_sha256: [u8; 32],
    pub prompt_policy_version: u32,
    pub old_context_estimate: u64,
    pub summary_prompt_tokens: Option<u64>,
    pub summary_completion_tokens: Option<u64>,
    pub new_context_estimate: u64,
    pub created_at: String,
}

const CHECKPOINT_COLUMNS: &str =
    "id, session_id, previous_checkpoint_id, summary, tail_start_message_index, \
     source_prefix_sha256, system_policy_sha256, prompt_policy_version, \
     old_context_estimate, summary_prompt_tokens, summary_completion_tokens, \
     new_context_estimate, created_at";

pub(crate) fn append_orchestrator_compaction_checkpoint(
    path: &Path,
    checkpoint: &NewOrchestratorCompactionCheckpoint,
) -> Result<OrchestratorCompactionCheckpoint> {
    validate_new_checkpoint(checkpoint)?;

    let tail_start_message_index = sqlite_i64_from_usize(
        checkpoint.tail_start_message_index,
        "tail_start_message_index",
    )?;
    let prompt_policy_version = i64::from(checkpoint.prompt_policy_version);
    let old_context_estimate =
        sqlite_i64_from_token_count(checkpoint.old_context_estimate, "old_context_estimate")?;
    let summary_prompt_tokens = checkpoint
        .summary_prompt_tokens
        .map(|value| sqlite_i64_from_token_count(value, "summary_prompt_tokens"))
        .transpose()?;
    let summary_completion_tokens = checkpoint
        .summary_completion_tokens
        .map(|value| sqlite_i64_from_token_count(value, "summary_completion_tokens"))
        .transpose()?;
    let new_context_estimate =
        sqlite_i64_from_token_count(checkpoint.new_context_estimate, "new_context_estimate")?;

    let mut conn = open_runtime_connection(path)?;
    // Keep persistence on this path synchronous so cancellation can occur only
    // before or after the checkpoint is durable. The IMMEDIATE transaction
    // contains only local validation, one insert, and one readback; no await or
    // model work occurs while the SQLite write lock is held.
    let transaction = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

    let session_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = ?1)",
        params![checkpoint.session_id],
        |row| row.get(0),
    )?;
    if !session_exists {
        return Err(anyhow!(
            "cannot append orchestrator compaction checkpoint: session {} does not exist",
            checkpoint.session_id
        ));
    }

    if let Some(parent_id) = checkpoint.previous_checkpoint_id {
        let parent = transaction
            .query_row(
                "SELECT session_id, tail_start_message_index
                 FROM orchestrator_compaction_checkpoints
                 WHERE id = ?1",
                params![parent_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let Some((parent_session_id, parent_tail_start)) = parent else {
            return Err(anyhow!(
                "cannot append orchestrator compaction checkpoint: parent {parent_id} does not exist"
            ));
        };
        if parent_session_id != checkpoint.session_id {
            return Err(anyhow!(
                "cannot append orchestrator compaction checkpoint: parent {parent_id} belongs to a different session"
            ));
        }
        if parent_tail_start >= tail_start_message_index {
            return Err(anyhow!(
                "cannot append orchestrator compaction checkpoint: tail boundary {} must be greater than parent {parent_id} boundary {parent_tail_start}",
                checkpoint.tail_start_message_index
            ));
        }
    }

    transaction.execute(
        "INSERT INTO orchestrator_compaction_checkpoints
             (session_id, previous_checkpoint_id, summary, tail_start_message_index,
              source_prefix_sha256, system_policy_sha256, prompt_policy_version,
              old_context_estimate, summary_prompt_tokens, summary_completion_tokens,
              new_context_estimate, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            checkpoint.session_id,
            checkpoint.previous_checkpoint_id,
            checkpoint.summary,
            tail_start_message_index,
            checkpoint.source_prefix_sha256.as_slice(),
            checkpoint.system_policy_sha256.as_slice(),
            prompt_policy_version,
            old_context_estimate,
            summary_prompt_tokens,
            summary_completion_tokens,
            new_context_estimate,
            now_utc(),
        ],
    )?;
    let id = transaction.last_insert_rowid();
    let inserted = load_checkpoint_by_id(&transaction, id)?
        .ok_or_else(|| anyhow!("inserted orchestrator compaction checkpoint {id} was not found"))?;
    transaction.commit()?;
    Ok(inserted)
}

pub(crate) fn load_orchestrator_compaction_checkpoints(
    path: &Path,
    session_id: &str,
) -> Result<Vec<OrchestratorCompactionCheckpoint>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn.prepare(&format!(
        "SELECT {CHECKPOINT_COLUMNS}
         FROM orchestrator_compaction_checkpoints
         WHERE session_id = ?1
         ORDER BY id DESC"
    ))?;
    let mut rows = statement.query_map(params![session_id], map_checkpoint_row)?;
    let mut checkpoints = Vec::new();
    for row in &mut rows {
        match row {
            Ok(checkpoint) => checkpoints.push(checkpoint),
            Err(error) if is_checkpoint_decode_error(&error) => {
                eprintln!("nac: skipping malformed orchestrator compaction checkpoint: {error}");
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(checkpoints)
}

fn is_checkpoint_decode_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::FromSqlConversionFailure(..)
            | rusqlite::Error::IntegralValueOutOfRange(..)
            | rusqlite::Error::InvalidColumnType(..)
    )
}

fn load_checkpoint_by_id(
    conn: &Connection,
    id: i64,
) -> Result<Option<OrchestratorCompactionCheckpoint>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {CHECKPOINT_COLUMNS}
                 FROM orchestrator_compaction_checkpoints
                 WHERE id = ?1"
            ),
            params![id],
            map_checkpoint_row,
        )
        .optional()?)
}

fn map_checkpoint_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<OrchestratorCompactionCheckpoint> {
    Ok(OrchestratorCompactionCheckpoint {
        id: row.get(0)?,
        session_id: row.get(1)?,
        previous_checkpoint_id: row.get(2)?,
        summary: row.get(3)?,
        tail_start_message_index: usize_from_sqlite(row.get(4)?, 4)?,
        source_prefix_sha256: digest_from_sqlite(row.get(5)?, 5)?,
        system_policy_sha256: digest_from_sqlite(row.get(6)?, 6)?,
        prompt_policy_version: u32_from_sqlite(row.get(7)?, 7)?,
        old_context_estimate: token_count_from_sqlite(row.get(8)?, 8)?,
        summary_prompt_tokens: row
            .get::<_, Option<i64>>(9)?
            .map(|value| token_count_from_sqlite(value, 9))
            .transpose()?,
        summary_completion_tokens: row
            .get::<_, Option<i64>>(10)?
            .map(|value| token_count_from_sqlite(value, 10))
            .transpose()?,
        new_context_estimate: token_count_from_sqlite(row.get(11)?, 11)?,
        created_at: row.get(12)?,
    })
}

fn validate_new_checkpoint(checkpoint: &NewOrchestratorCompactionCheckpoint) -> Result<()> {
    if checkpoint.session_id.trim().is_empty() {
        return Err(anyhow!("checkpoint session id is empty"));
    }
    if checkpoint.summary.trim().is_empty() {
        return Err(anyhow!("checkpoint summary is empty"));
    }
    if checkpoint.prompt_policy_version == 0 {
        return Err(anyhow!("checkpoint prompt policy version must be positive"));
    }
    Ok(())
}

fn sqlite_i64_from_usize(value: usize, field: &str) -> Result<i64> {
    i64::try_from(value).map_err(|_| anyhow!("checkpoint {field} exceeds SQLite INTEGER range"))
}

fn sqlite_i64_from_token_count(value: u64, field: &str) -> Result<i64> {
    if value > crate::MAX_SUPPORTED_TOKEN_COUNT {
        return Err(anyhow!(
            "checkpoint {field} exceeds supported token maximum {}",
            crate::MAX_SUPPORTED_TOKEN_COUNT
        ));
    }
    Ok(value as i64)
}

fn usize_from_sqlite(value: i64, column: usize) -> rusqlite::Result<usize> {
    usize::try_from(value).map_err(|error| integral_conversion_error(column, error))
}

fn u32_from_sqlite(value: i64, column: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|error| integral_conversion_error(column, error))
}

fn token_count_from_sqlite(value: i64, column: usize) -> rusqlite::Result<u64> {
    let value = u64::try_from(value).map_err(|error| integral_conversion_error(column, error))?;
    if value > crate::MAX_SUPPORTED_TOKEN_COUNT {
        return Err(integral_conversion_error(
            column,
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!(
                    "token count {value} exceeds supported maximum {}",
                    crate::MAX_SUPPORTED_TOKEN_COUNT
                ),
            ),
        ));
    }
    Ok(value)
}

fn integral_conversion_error(
    column: usize,
    error: impl std::error::Error + Send + Sync + 'static,
) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Integer,
        Box::new(error),
    )
}

fn digest_from_sqlite(value: Vec<u8>, column: usize) -> rusqlite::Result<[u8; 32]> {
    value.try_into().map_err(|value: Vec<u8>| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Blob,
            format!(
                "expected 32-byte SHA-256 digest, found {} bytes",
                value.len()
            )
            .into(),
        )
    })
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
            .join(format!("nac_compaction_checkpoint_{label}_{unique}"))
            .join("store.db")
    }

    fn checkpoint(
        session_id: &str,
        parent_id: Option<i64>,
        tail_start_message_index: usize,
        summary: &str,
    ) -> NewOrchestratorCompactionCheckpoint {
        NewOrchestratorCompactionCheckpoint {
            session_id: session_id.to_string(),
            previous_checkpoint_id: parent_id,
            summary: summary.to_string(),
            tail_start_message_index,
            source_prefix_sha256: [tail_start_message_index as u8; 32],
            system_policy_sha256: [42; 32],
            prompt_policy_version: 1,
            old_context_estimate: 12_000,
            summary_prompt_tokens: Some(10_000),
            summary_completion_tokens: Some(500),
            new_context_estimate: 2_500,
        }
    }

    #[test]
    fn append_round_trips_exact_values_and_loads_newest_first() {
        let path = temp_store_path("round_trip");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");

        let first_summary = "  <summary>\nfirst\n</summary>  ";
        let first = append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("session-a", None, 4, first_summary),
        )
        .unwrap();
        let mut second_input = checkpoint("session-a", Some(first.id), 9, "second");
        second_input.summary_prompt_tokens = None;
        second_input.summary_completion_tokens = None;
        let second = append_orchestrator_compaction_checkpoint(&path, &second_input).unwrap();

        let loaded = load_orchestrator_compaction_checkpoints(&path, "session-a").unwrap();
        assert_eq!(loaded, vec![second.clone(), first.clone()]);
        assert_eq!(first.summary, first_summary);
        assert_eq!(first.previous_checkpoint_id, None);
        assert_eq!(second.previous_checkpoint_id, Some(first.id));
        assert_eq!(second.tail_start_message_index, 9);
        assert_eq!(second.source_prefix_sha256, [9; 32]);
        assert_eq!(second.system_policy_sha256, [42; 32]);
        assert_eq!(second.prompt_policy_version, 1);
        assert_eq!(second.old_context_estimate, 12_000);
        assert_eq!(second.summary_prompt_tokens, None);
        assert_eq!(second.summary_completion_tokens, None);
        assert_eq!(second.new_context_estimate, 2_500);
        assert!(!second.created_at.is_empty());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn append_rejects_missing_or_cross_session_parents_and_nonadvancing_boundaries() {
        let path = temp_store_path("parents");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        insert_test_session(&path, "session-b");
        let parent = append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("session-a", None, 10, "parent"),
        )
        .unwrap();

        let missing = append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("session-a", Some(parent.id + 1000), 11, "missing"),
        )
        .unwrap_err();
        assert!(missing.to_string().contains("does not exist"));

        let cross_session = append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("session-b", Some(parent.id), 11, "cross-session"),
        )
        .unwrap_err();
        assert!(cross_session.to_string().contains("different session"));

        for boundary in [9, 10] {
            let error = append_orchestrator_compaction_checkpoint(
                &path,
                &checkpoint("session-a", Some(parent.id), boundary, "not advancing"),
            )
            .unwrap_err();
            assert!(error.to_string().contains("must be greater"));
        }

        let session_a = load_orchestrator_compaction_checkpoints(&path, "session-a").unwrap();
        assert_eq!(session_a, vec![parent]);
        assert!(load_orchestrator_compaction_checkpoints(&path, "session-b")
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn failed_appends_leave_no_rows_and_session_delete_cascades_checkpoint_chain() {
        let path = temp_store_path("rollback_and_cascade");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");

        let missing_session = append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("missing", None, 2, "summary"),
        )
        .unwrap_err();
        assert!(missing_session.to_string().contains("does not exist"));
        assert!(load_orchestrator_compaction_checkpoints(&path, "missing")
            .unwrap()
            .is_empty());

        let blank = append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("session-a", None, 2, " \n "),
        )
        .unwrap_err();
        assert!(blank.to_string().contains("summary is empty"));
        assert!(load_orchestrator_compaction_checkpoints(&path, "session-a")
            .unwrap()
            .is_empty());

        let first = append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("session-a", None, 2, "first"),
        )
        .unwrap();
        append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("session-a", Some(first.id), 5, "second"),
        )
        .unwrap();
        assert_eq!(
            load_orchestrator_compaction_checkpoints(&path, "session-a")
                .unwrap()
                .len(),
            2
        );

        assert!(crate::sessions::delete_session(&path, "session-a").unwrap());
        assert!(load_orchestrator_compaction_checkpoints(&path, "session-a")
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn loader_skips_malformed_rows_but_propagates_database_failures() {
        let path = temp_store_path("malformed_fallback");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let valid = append_orchestrator_compaction_checkpoint(
            &path,
            &checkpoint("session-a", None, 2, "valid"),
        )
        .unwrap();

        let conn = open_runtime_connection(&path).unwrap();
        conn.pragma_update(None, "ignore_check_constraints", "ON")
            .unwrap();
        conn.execute(
            "INSERT INTO orchestrator_compaction_checkpoints
                 (session_id, previous_checkpoint_id, summary, tail_start_message_index,
                  source_prefix_sha256, system_policy_sha256, prompt_policy_version,
                  old_context_estimate, summary_prompt_tokens, summary_completion_tokens,
                  new_context_estimate, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, NULL, ?9, ?10)",
            params![
                "session-a",
                valid.id,
                "malformed newest",
                3_i64,
                vec![1_u8; 32],
                vec![2_u8; 32],
                1_i64,
                (crate::MAX_SUPPORTED_TOKEN_COUNT + 1) as i64,
                50_i64,
                now_utc(),
            ],
        )
        .unwrap();
        drop(conn);

        assert_eq!(
            load_orchestrator_compaction_checkpoints(&path, "session-a").unwrap(),
            vec![valid]
        );

        let corrupt_path = temp_store_path("query_failure");
        std::fs::create_dir_all(corrupt_path.parent().unwrap()).unwrap();
        std::fs::write(&corrupt_path, b"not a sqlite database").unwrap();
        assert!(load_orchestrator_compaction_checkpoints(&corrupt_path, "session-a").is_err());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
        let _ = std::fs::remove_dir_all(corrupt_path.parent().unwrap());
    }

    #[test]
    fn checkpoint_token_conversion_enforces_supported_maximum() {
        let maximum = crate::MAX_SUPPORTED_TOKEN_COUNT;
        assert_eq!(
            sqlite_i64_from_token_count(maximum, "test").unwrap(),
            maximum as i64
        );
        assert!(sqlite_i64_from_token_count(maximum + 1, "test").is_err());
        assert_eq!(token_count_from_sqlite(maximum as i64, 0).unwrap(), maximum);
        assert!(token_count_from_sqlite((maximum + 1) as i64, 0).is_err());
    }

    #[test]
    fn append_rejects_values_above_supported_token_maximum() {
        let path = temp_store_path("token_range");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let mut input = checkpoint("session-a", None, 2, "summary");
        input.new_context_estimate = crate::MAX_SUPPORTED_TOKEN_COUNT + 1;

        let error = append_orchestrator_compaction_checkpoint(&path, &input).unwrap_err();
        assert!(error
            .to_string()
            .contains("exceeds supported token maximum"));
        assert!(load_orchestrator_compaction_checkpoints(&path, "session-a")
            .unwrap()
            .is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
