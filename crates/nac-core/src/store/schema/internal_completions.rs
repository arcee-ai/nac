use super::*;

/// Schema 41 records which owned relationship generation admitted an inbox
/// row. Columns are additive and NULL for every other row, so existing
/// readers and person/automation input keep their meaning.
pub(super) fn ensure_columns(connection: &Connection) -> Result<()> {
    ensure_column(
        connection,
        "session_inbox",
        "completion_source",
        "TEXT CHECK (completion_source IN ('traditional_child', 'managed_orchestrator'))",
    )?;
    ensure_column(
        connection,
        "session_inbox",
        "completion_session_id",
        "TEXT CHECK ((completion_session_id IS NULL) = (completion_source IS NULL))",
    )?;
    ensure_column(
        connection,
        "session_inbox",
        "completion_generation",
        "INTEGER CHECK ((completion_generation IS NULL) = (completion_source IS NULL)) \
         CHECK (completion_generation IS NULL OR completion_generation > 0)",
    )?;
    Ok(())
}

/// Classify legacy rows that are still pending, and only from durable
/// relationship or terminal-receipt evidence that names this exact row for
/// the same parent. Text is never consulted. Delivered and cancelled rows are
/// left byte-for-byte unchanged, as is every other column of a classified
/// row: delivery, binding, version and status remain what was committed.
/// Rows with conflicting evidence stay unclassified (ordinary input).
pub(super) fn classify_pending_legacy_completions(connection: &Connection) -> Result<()> {
    const ELIGIBLE: &str = "inbox.status = 'pending' AND inbox.completion_source IS NULL
         AND inbox.review_intent IS NULL AND inbox.client_id IS NULL
         AND inbox.admission_id IS NULL";
    let evidence = format!(
        "SELECT inbox.id, 'traditional_child', child.child_session_id, child.generation
         FROM traditional_children AS child
         JOIN session_inbox AS inbox
           ON inbox.id = child.completion_inbox_id
          AND inbox.session_id = child.parent_session_id
         WHERE {ELIGIBLE}
         UNION
         SELECT inbox.id, 'traditional_child', receipt.child_session_id, receipt.generation
         FROM traditional_child_terminal_receipts AS receipt
         JOIN traditional_children AS child USING (child_session_id)
         JOIN session_inbox AS inbox
           ON inbox.id = json_extract(receipt.record_json, '$.completion_inbox_id')
          AND inbox.session_id = child.parent_session_id
         WHERE {ELIGIBLE}
         UNION
         SELECT inbox.id, 'managed_orchestrator', managed.orchestrator_session_id,
                managed.generation
         FROM managed_orchestrators AS managed
         JOIN session_inbox AS inbox
           ON inbox.id = managed.completion_inbox_id
          AND inbox.session_id = managed.parent_session_id
         WHERE {ELIGIBLE}
         UNION
         SELECT inbox.id, 'managed_orchestrator', receipt.orchestrator_session_id,
                receipt.generation
         FROM managed_orchestrator_terminal_receipts AS receipt
         JOIN managed_orchestrators AS managed USING (orchestrator_session_id)
         JOIN session_inbox AS inbox
           ON inbox.id = json_extract(receipt.record_json, '$.completion_inbox_id')
          AND inbox.session_id = managed.parent_session_id
         WHERE {ELIGIBLE}"
    );
    let mut found: std::collections::BTreeMap<i64, Option<(String, String, u64)>> =
        std::collections::BTreeMap::new();
    {
        let mut statement = connection.prepare(&evidence)?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                (
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u64>(3)?,
                ),
            ))
        })?;
        for row in rows {
            let (id, origin) = row?;
            found
                .entry(id)
                .and_modify(|current| {
                    if current.as_ref() != Some(&origin) {
                        *current = None;
                    }
                })
                .or_insert(Some(origin));
        }
    }
    for (id, origin) in found {
        let Some((source, session_id, generation)) = origin else {
            continue;
        };
        if generation == 0 {
            continue;
        }
        connection.execute(
            "UPDATE session_inbox
             SET completion_source = ?2, completion_session_id = ?3,
                 completion_generation = ?4
             WHERE id = ?1 AND status = 'pending' AND completion_source IS NULL",
            params![id, source, session_id, generation],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
