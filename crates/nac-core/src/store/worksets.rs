use super::*;

pub fn define_workset(path: &Path, session_id: &str, workset: &WorksetDefinition) -> Result<()> {
    let mut conn = open_connection(path)?;
    let tx = conn.transaction()?;
    let now = now_utc();
    let created_at = tx
        .query_row(
            "SELECT created_at
             FROM worksets
             WHERE id = ?1 AND session_id = ?2",
            params![workset.id, session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_else(|| now.clone());

    tx.execute(
        "INSERT INTO worksets (
             id, session_id, kind, instruction, status, summary, verification_recipe, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id, session_id) DO UPDATE SET
             kind = excluded.kind,
             instruction = excluded.instruction,
             status = excluded.status,
             summary = excluded.summary,
             verification_recipe = excluded.verification_recipe,
             updated_at = excluded.updated_at",
        params![
            workset.id,
            session_id,
            "plan",
            workset.goal,
            workset.status,
            workset.summary,
            workset.verification_recipe,
            created_at,
            now,
        ],
    )?;

    tx.execute(
        "DELETE FROM workset_items WHERE workset_id = ?1 AND session_id = ?2",
        params![workset.id, session_id],
    )?;

    for (index, item) in workset.items.iter().enumerate() {
        // Worksets used to expose kind/instruction/thread-oriented fields. Keep the
        // old SQLite columns as compatibility storage while the public schema uses
        // goal/role/depends_on/acceptance/notes.
        tx.execute(
            "INSERT INTO workset_items (
                 workset_id, session_id, position, title, thread_name, scope, description,
                 item_kind, status, source_threads_json, last_summary, acceptance, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                workset.id,
                session_id,
                index as i64 + 1,
                item.title,
                "",
                item.scope,
                item.description,
                item.role,
                "planned",
                serde_json::to_string(&item.depends_on)?,
                item.notes,
                item.acceptance,
                now,
            ],
        )?;
    }

    tx.commit()?;
    Ok(())
}

pub fn read_workset(path: &Path, session_id: &str, id: &str) -> Result<Option<WorksetRecord>> {
    let conn = open_connection(path)?;
    let Some(mut workset) = conn
        .query_row(
            "SELECT id, session_id, instruction, status, summary, verification_recipe, created_at, updated_at
             FROM worksets
             WHERE id = ?1 AND session_id = ?2",
            params![id, session_id],
            row_to_workset,
        )
        .optional()?
    else {
        return Ok(None);
    };
    workset.items = load_workset_items(&conn, session_id, id)?;
    Ok(Some(workset))
}

pub fn list_worksets(path: &Path, session_id: &str) -> Result<Vec<WorksetSummary>> {
    let conn = open_connection(path)?;
    let sql = "SELECT w.id, w.status, w.summary,
               (SELECT COUNT(*) FROM workset_items i
                WHERE i.workset_id = w.id AND i.session_id = w.session_id) AS item_count,
               w.updated_at
         FROM worksets w
         WHERE w.session_id = ?1
         ORDER BY w.updated_at DESC, w.id ASC";
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query(params![session_id])?;

    let mut worksets = Vec::new();
    while let Some(row) = rows.next()? {
        worksets.push(WorksetSummary {
            id: row.get(0)?,
            status: row.get(1)?,
            summary: row.get(2)?,
            item_count: row.get(3)?,
            updated_at: row.get(4)?,
        });
    }
    Ok(worksets)
}

fn row_to_workset(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorksetRecord> {
    Ok(WorksetRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        goal: row.get(2)?,
        status: row.get(3)?,
        summary: row.get(4)?,
        verification_recipe: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        items: Vec::new(),
    })
}

fn load_workset_items(
    conn: &Connection,
    session_id: &str,
    workset_id: &str,
) -> Result<Vec<WorksetItemRecord>> {
    let mut stmt = conn.prepare(
        "SELECT position, title, scope, description, item_kind,
                source_threads_json, last_summary, acceptance, updated_at
         FROM workset_items
         WHERE workset_id = ?1 AND session_id = ?2
         ORDER BY position ASC",
    )?;
    let mut rows = stmt.query(params![workset_id, session_id])?;
    let mut items = Vec::new();
    while let Some(row) = rows.next()? {
        let depends_on_json: String = row.get(5)?;
        let depends_on = serde_json::from_str::<Vec<String>>(&depends_on_json)
            .unwrap_or_else(|_| vec![depends_on_json]);
        items.push(WorksetItemRecord {
            position: row.get(0)?,
            title: row.get(1)?,
            scope: row.get(2)?,
            description: row.get(3)?,
            role: row.get(4)?,
            depends_on,
            notes: row.get(6)?,
            acceptance: row.get(7)?,
            updated_at: row.get(8)?,
        });
    }
    Ok(items)
}
