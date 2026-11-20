//! Reorder supported legacy session columns without replacing the parent table.
//!
//! Each moved column is staged in one nullable column in the same protected
//! database, verified byte/type-equivalent, and moved to its canonical position.
//! No transcript or credential material is copied to a separate temp file.
//! This performs at most one table rewrite per moved column (plus a possible
//! reviewer dependency move); large stores need corresponding WAL space. Any
//! SQLite error rolls back the enclosing migration transaction.
use super::*;

#[derive(Debug)]
struct Column {
    name: String,
    definition: String,
    affinity: String,
}

fn columns(conn: &Connection, sql: &str) -> Result<Vec<Column>> {
    let start = sql.find('(').context("missing sessions definition")?;
    let prefix = sql[..start]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    anyhow::ensure!(
        prefix == "CREATE TABLE sessions" || prefix == "CREATE TABLE \"sessions\"",
        "unsupported sessions table declaration"
    );
    let bytes = sql.as_bytes();
    let mut index = start + 1;
    let mut section_start = index;
    let mut depth = 1usize;
    let mut segments = Vec::new();
    while index < bytes.len() {
        match bytes[index] {
            b'-' if bytes.get(index + 1) == Some(&b'-') => {
                anyhow::bail!("comments in sessions definition are unsupported")
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                anyhow::bail!("comments in sessions definition are unsupported")
            }
            quote @ (b'\'' | b'"' | b'`' | b'[') => {
                let end = if quote == b'[' { b']' } else { quote };
                index += 1;
                let mut closed = false;
                while index < bytes.len() {
                    if bytes[index] == end {
                        if quote != b'[' && bytes.get(index + 1) == Some(&end) {
                            index += 2;
                        } else {
                            index += 1;
                            closed = true;
                            break;
                        }
                    } else {
                        index += 1;
                    }
                }
                anyhow::ensure!(closed, "unterminated sessions SQL quote");
            }
            b'(' => {
                depth += 1;
                index += 1;
            }
            b')' => {
                depth = depth
                    .checked_sub(1)
                    .context("invalid sessions SQL nesting")?;
                if depth == 0 {
                    segments.push(
                        sql[section_start..index]
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" "),
                    );
                    anyhow::ensure!(
                        sql[index + 1..].trim().is_empty(),
                        "unsupported sessions table suffix"
                    );
                    break;
                }
                index += 1;
            }
            b',' if depth == 1 => {
                segments.push(
                    sql[section_start..index]
                        .split_whitespace()
                        .collect::<Vec<_>>()
                        .join(" "),
                );
                index += 1;
                section_start = index;
            }
            _ => index += 1,
        }
    }
    anyhow::ensure!(
        depth == 0 && !segments.is_empty(),
        "incomplete sessions definition"
    );
    let mut table_info = conn.prepare("PRAGMA table_xinfo(sessions)")?;
    let info = table_info
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    anyhow::ensure!(
        info.len() == segments.len(),
        "unsupported sessions table constraints or columns"
    );
    let mut result = Vec::with_capacity(info.len());
    for ((name, affinity, hidden), definition) in info.into_iter().zip(segments) {
        anyhow::ensure!(
            hidden == 0
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                && definition.split_whitespace().next() == Some(name.as_str())
                && matches!(affinity.as_str(), "TEXT" | "INTEGER"),
            "unsupported sessions column {name}"
        );
        result.push(Column {
            name,
            definition,
            affinity,
        });
    }
    Ok(result)
}

fn canonical() -> Result<(String, Vec<Column>)> {
    let memory = Connection::open_in_memory()?;
    memory.execute_batch(include_str!("current.sql"))?;
    let sql: String = memory.query_row(
        "SELECT sql FROM sqlite_schema WHERE type='table' AND name='sessions'",
        [],
        |row| row.get(0),
    )?;
    let columns = columns(&memory, &sql)?;
    Ok((sql, columns))
}

#[cfg(test)]
thread_local! { pub(super) static FAIL_PHASE: std::cell::Cell<u8> = const { std::cell::Cell::new(0) }; }

fn checkpoint(phase: u8) -> Result<()> {
    #[cfg(test)]
    if FAIL_PHASE.with(|failure| failure.get() == phase) {
        anyhow::bail!("injected session normalization failure at phase {phase}");
    }
    let _ = phase;
    Ok(())
}

fn move_to_end(conn: &Connection, column: &Column) -> Result<()> {
    let name = &column.name;
    let staged = "__nac_v56_session_value";
    conn.execute_batch(&format!(
        "ALTER TABLE sessions ADD COLUMN {staged} {}",
        column.affinity
    ))?;
    checkpoint(1)?;
    conn.execute_batch(&format!("UPDATE sessions SET {staged}=\"{name}\""))?;
    checkpoint(2)?;
    let changed: bool = conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM sessions WHERE {staged} IS NOT \"{name}\" OR typeof({staged}) <> typeof(\"{name}\"))"), [], |row| row.get(0))?;
    anyhow::ensure!(
        !changed,
        "session column value or type changed while moving {name}"
    );
    conn.execute_batch(&format!("ALTER TABLE sessions DROP COLUMN \"{name}\""))?;
    checkpoint(3)?;
    conn.execute_batch(&format!(
        "ALTER TABLE sessions RENAME COLUMN {staged} TO \"{name}\""
    ))?;
    checkpoint(4)?;
    Ok(())
}

pub(super) fn normalize(conn: &Connection) -> Result<()> {
    let sql: String = conn.query_row(
        "SELECT sql FROM sqlite_schema WHERE type='table' AND name='sessions'",
        [],
        |row| row.get(0),
    )?;
    let old = columns(conn, &sql)?;
    let (target_sql, target) = canonical()?;
    anyhow::ensure!(
        old.len() == target.len(),
        "unsupported sessions column count"
    );
    for expected in &target {
        let matches: Vec<_> = old
            .iter()
            .filter(|column| column.name == expected.name)
            .collect();
        anyhow::ensure!(
            matches.len() == 1
                && matches[0].definition == expected.definition
                && matches[0].affinity == expected.affinity,
            "unsupported sessions column definition for {}",
            expected.name
        );
    }
    let old_names: Vec<_> = old.iter().map(|column| column.name.as_str()).collect();
    let target_names: Vec<_> = target.iter().map(|column| column.name.as_str()).collect();
    if old_names == target_names && sql.split_whitespace().eq(target_sql.split_whitespace()) {
        return Ok(());
    }
    let triggers: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND tbl_name='sessions'",
        [],
        |row| row.get(0),
    )?;
    anyhow::ensure!(
        triggers == 0,
        "unsupported sessions triggers during column normalization"
    );
    let mut index_query = conn.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='sessions' AND sql IS NOT NULL ORDER BY name")?;
    let indices = index_query
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    anyhow::ensure!(
        indices.len() == 1
            && indices[0].0 == "idx_sessions_updated_at"
            && indices[0]
                .1
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                == "CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC)",
        "unsupported sessions indexes during column normalization"
    );
    drop(index_query);

    let mut keep = 0usize;
    let mut cursor = 0usize;
    for name in &target_names {
        if let Some(offset) = old_names[cursor..]
            .iter()
            .position(|old_name| old_name == name)
        {
            cursor += offset + 1;
            keep += 1;
        } else {
            break;
        }
    }
    anyhow::ensure!(
        keep >= 1 && target_names[0] == "session_id",
        "unsupported sessions identity order"
    );
    if old_names != target_names {
        conn.execute_batch("DROP INDEX idx_sessions_updated_at")?;
        // The reviewer's CHECK depends on permission_approval_mode. Move it
        // once first if that dependency must be removed, then in target order.
        if target[keep..]
            .iter()
            .any(|column| column.name == "permission_approval_mode")
        {
            let reviewer = target
                .iter()
                .find(|column| column.name == "permission_reviewer")
                .context("missing permission reviewer")?;
            move_to_end(conn, reviewer)?;
        }
        for column in &target[keep..] {
            move_to_end(conn, column)?;
        }
        conn.execute_batch("CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC)")?;
    }
    let actual_names: Vec<String> = {
        let mut query = conn.prepare("PRAGMA table_xinfo(sessions)")?;
        let rows = query
            .query_map([], |row| row.get(1))?
            .collect::<rusqlite::Result<_>>()?;
        rows
    };
    anyhow::ensure!(
        actual_names.iter().map(String::as_str).collect::<Vec<_>>() == target_names,
        "sessions column normalization did not converge"
    );
    let current_sql: String = conn.query_row(
        "SELECT sql FROM sqlite_schema WHERE name='sessions' AND type='table'",
        [],
        |row| row.get(0),
    )?;
    let cookie: i64 = conn.pragma_query_value(None, "schema_version", |row| row.get(0))?;
    let next = cookie
        .checked_add(1)
        .filter(|value| *value <= i32::MAX as i64)
        .context("SQLite schema cookie exhausted")?;
    conn.execute_batch("PRAGMA writable_schema=ON")?;
    let result = (|| -> Result<()> {
        anyhow::ensure!(
            conn.execute(
                "UPDATE sqlite_schema SET sql=?1 WHERE type='table' AND name='sessions' AND sql=?2",
                params![target_sql, current_sql]
            )? == 1,
            "sessions catalog changed during normalization"
        );
        conn.pragma_update(None, "schema_version", next)?;
        Ok(())
    })();
    let reset = conn.execute_batch("PRAGMA writable_schema=OFF");
    result?;
    reset?;
    Ok(())
}
