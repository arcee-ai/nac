//! The messages a person typed to a session tree, which Approve for me
//! weighs as their intent. They are recorded in the same transaction that
//! hands each message to the model, so a reviewer never sees text the model
//! has not received, and text that never reaches the model (a rejected
//! prompt, a cancelled inbox item) never becomes intent.
//!
//! Messages accumulate across runs: a new prompt does not lift a restriction
//! from an earlier one. Turning Approve for me off clears them (see
//! `compare_and_update_permission_approval_state`), so the next messages
//! start a fresh scope.

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
}

/// Records a person's message as review intent for the session tree that
/// owns `session_id`'s answer policy. Call it only inside the transaction
/// that delivers `text` to the model.
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
        Some(StoredReviewIntent::Overflowed) => return Ok(()),
    };
    messages.push(text.to_owned());
    let chars: usize = messages.iter().map(|message| message.chars().count()).sum();
    let intent = if messages.len() > MAX_INTENT_MESSAGES || chars > MAX_INTENT_CHARS {
        StoredReviewIntent::Overflowed
    } else {
        StoredReviewIntent::Messages(messages)
    };
    connection.execute(
        "UPDATE sessions SET permission_review_intent = ?1 WHERE session_id = ?2",
        params![serde_json::to_string(&intent)?, root],
    )?;
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
}
