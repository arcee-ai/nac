//! The messages a person typed to a session tree, which Approve for me
//! weighs as their intent. They are recorded in the same transaction that
//! hands each message to the model, so a reviewer never sees text the model
//! has not received, and text that never reaches the model (a rejected
//! prompt, a cancelled inbox item) never becomes intent.
//!
//! Messages accumulate across runs: a new prompt does not lift a restriction
//! from an earlier one. Changing into or out of Approve for me clears them (see
//! `compare_and_update_permission_approval_state`), so the next messages
//! start a fresh scope. Removing user transcript history invalidates the
//! tree's scope until that reset: retained text has no message provenance
//! from which to reconstruct only the still-authoritative human inputs.

use super::*;

/// Most messages kept. A longer history is marked overflowed: dropping the
/// oldest could drop a restriction the person still means.
const MAX_INTENT_MESSAGES: usize = 20;
/// Most characters kept across the messages, under the same rule.
const MAX_INTENT_CHARS: usize = 8_000;

/// Who typed a prompt, inbox item or steering message. Only human-facing
/// routes pass `Person`; Approve for me weighs only a person's messages as
/// their intent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputOrigin {
    Person,
    Automation,
}

/// The stored form of `sessions.permission_review_intent`.
#[derive(Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StoredReviewIntent {
    /// The person's messages, oldest first.
    Messages(Vec<String>),
    /// The messages outgrew the limits; review keeps the manual path until
    /// Approve for me is turned off and on again.
    Overflowed,
    /// User history was removed or changed. Do not infer surviving authority
    /// from the remaining transcript, which also contains automation text.
    Invalidated,
}

/// Records a person's message as review intent for the session tree that
/// owns `session_id`'s answer policy. Call it only inside the transaction
/// that delivers `text` to the model. An active review scope change advances
/// its root revision in the same write, invalidating in-flight sibling verdicts.
pub(crate) fn record_review_intent(
    connection: &Connection,
    session_id: &str,
    text: &str,
) -> Result<()> {
    let root: String = connection
        .query_row(
            "SELECT COALESCE(
                 (SELECT root_session_id FROM traditional_children WHERE child_session_id = ?1),
                 ?1)",
            params![session_id],
            |row| row.get(0),
        )
        .context("resolve the session tree for review intent")?;
    let stored: Option<String> = connection
        .query_row(
            "SELECT permission_review_intent FROM sessions WHERE session_id = ?1",
            params![root],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| anyhow!("session '{root}' was not found"))?;
    let mut messages = match stored.as_deref().map(decode_review_intent) {
        None => Vec::new(),
        Some(StoredReviewIntent::Messages(messages)) => messages,
        Some(StoredReviewIntent::Overflowed | StoredReviewIntent::Invalidated) => return Ok(()),
    };
    messages.push(text.to_owned());
    let chars: usize = messages.iter().map(|message| message.chars().count()).sum();
    let intent = if messages.len() > MAX_INTENT_MESSAGES || chars > MAX_INTENT_CHARS {
        StoredReviewIntent::Overflowed
    } else {
        StoredReviewIntent::Messages(messages)
    };
    connection.execute(
        "UPDATE sessions
         SET permission_review_intent = ?1,
             permission_approval_revision = permission_approval_revision + CASE
                 WHEN permission_reviewer = 'auto_review' THEN 1 ELSE 0 END
         WHERE session_id = ?2",
        params![serde_json::to_string(&intent)?, root],
    )?;
    Ok(())
}

/// Withdraw authority atomically with transcript truncation. Children share
/// their durable root's intent, so invalidate that whole policy scope. The
/// revision bump also discards sibling reviews already using the old text.
pub(crate) fn invalidate_review_intent(connection: &Connection, session_id: &str) -> Result<()> {
    let changed = connection.execute(
        "UPDATE sessions
         SET permission_review_intent = CASE
                 WHEN permission_review_intent IS NULL THEN NULL ELSE ?1 END,
             permission_approval_revision = permission_approval_revision + 1
         WHERE session_id = COALESCE(
             (SELECT root_session_id FROM traditional_children WHERE child_session_id = ?2), ?2)",
        params![
            serde_json::to_string(&StoredReviewIntent::Invalidated)?,
            session_id
        ],
    )?;
    anyhow::ensure!(
        changed == 1,
        "session tree for '{session_id}' was not found"
    );
    Ok(())
}

/// Decodes a stored intent. Anything unreadable counts as overflowed, so
/// review keeps the manual path rather than judging without scope.
pub(crate) fn decode_review_intent(stored: &str) -> StoredReviewIntent {
    serde_json::from_str(stored).unwrap_or(StoredReviewIntent::Overflowed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn intent(connection: &Connection, session_id: &str) -> Option<StoredReviewIntent> {
        connection
            .query_row(
                "SELECT permission_review_intent FROM sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap()
            .as_deref()
            .map(decode_review_intent)
    }

    fn store() -> StoreConnection {
        let path = std::env::temp_dir()
            .join(format!("nac_review_intent_{}", uuid::Uuid::new_v4()))
            .join("store.db");
        initialize(&path).unwrap();
        insert_test_session(&path, "root");
        open_runtime_connection(&path).unwrap()
    }

    #[test]
    fn messages_accumulate_so_earlier_restrictions_still_apply() {
        let connection = store();
        for text in ["fix the tests", "do not push", "continue"] {
            record_review_intent(&connection, "root", text).unwrap();
        }
        assert_eq!(
            intent(&connection, "root"),
            Some(StoredReviewIntent::Messages(vec![
                "fix the tests".into(),
                "do not push".into(),
                "continue".into(),
            ]))
        );
    }

    #[test]
    fn an_outgrown_history_stays_overflowed() {
        let connection = store();
        for _ in 0..=MAX_INTENT_MESSAGES {
            record_review_intent(&connection, "root", "more").unwrap();
        }
        assert_eq!(
            intent(&connection, "root"),
            Some(StoredReviewIntent::Overflowed)
        );
        record_review_intent(&connection, "root", "short").unwrap();
        assert_eq!(
            intent(&connection, "root"),
            Some(StoredReviewIntent::Overflowed)
        );

        let connection = store();
        let long = "é".repeat(MAX_INTENT_CHARS + 1);
        record_review_intent(&connection, "root", &long).unwrap();
        assert_eq!(
            intent(&connection, "root"),
            Some(StoredReviewIntent::Overflowed)
        );
    }

    #[test]
    fn unreadable_stored_intent_counts_as_overflowed() {
        assert_eq!(
            decode_review_intent("not json"),
            StoredReviewIntent::Overflowed
        );
    }

    fn approval(connection: &Connection) -> (String, String, i64, i64) {
        connection.query_row("SELECT permission_approval_mode, permission_reviewer, permission_auto_approve_generation, permission_approval_revision FROM sessions WHERE session_id = 'root'", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))).unwrap()
    }

    #[test]
    fn committed_active_scope_changes_and_overflow_advance_only_the_review_revision() {
        let connection = store();
        let manual = approval(&connection);
        record_review_intent(&connection, "root", "manual scope").unwrap();
        assert_eq!(approval(&connection), manual);
        connection.execute("UPDATE sessions SET permission_approval_mode = 'auto_approve', permission_auto_approve_generation = 7", []).unwrap();
        let automatic = approval(&connection);
        record_review_intent(&connection, "root", "auto-approve scope").unwrap();
        assert_eq!(approval(&connection), automatic);
        connection.execute("UPDATE sessions SET permission_approval_mode = 'manual', permission_reviewer = 'auto_review', permission_review_intent = NULL", []).unwrap();
        let before = approval(&connection);
        for _ in 0..=MAX_INTENT_MESSAGES {
            record_review_intent(&connection, "root", "continue; do not push").unwrap();
        }
        let after = approval(&connection);
        assert_eq!(
            (&after.0, &after.1, after.2),
            (&before.0, &before.1, before.2)
        );
        assert_eq!(
            after.3,
            before.3 + MAX_INTENT_MESSAGES as i64 + 1,
            "the overflow transition also changes scope"
        );
        assert_eq!(
            intent(&connection, "root"),
            Some(StoredReviewIntent::Overflowed)
        );
        record_review_intent(&connection, "root", "ignored after overflow").unwrap();
        assert_eq!(
            approval(&connection),
            after,
            "unchanged unavailable scope does not create more revisions"
        );
    }

    #[test]
    fn person_record_rollback_preserves_both_scope_and_revision() {
        let mut connection = store();
        connection
            .execute(
                "UPDATE sessions SET permission_reviewer = 'auto_review'",
                [],
            )
            .unwrap();
        record_review_intent(&connection, "root", "keep work local").unwrap();
        let before = approval(&connection);
        let transaction = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        record_review_intent(&transaction, "root", "publish release").unwrap();
        assert_eq!(approval(&transaction).3, before.3 + 1);
        transaction.rollback().unwrap();
        assert_eq!(approval(&connection), before);
        assert_eq!(
            intent(&connection, "root"),
            Some(StoredReviewIntent::Messages(vec!["keep work local".into()]))
        );
    }
}
