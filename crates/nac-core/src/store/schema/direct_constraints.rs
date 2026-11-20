//! Tighten direct-only constraints without rebuilding referenced tables.
//!
//! SQLite documents this catalog-edit procedure for changes that do not alter
//! the on-disk record format (https://www.sqlite.org/lang_altertable.html).
//! Rebuilding these tables would require disabling foreign keys before the
//! transaction, preventing earlier retirement migrations from cascading.
use super::*;

#[path = "session_layout.rs"]
mod session_layout;

const SESSION_CHECK: &str =
    "CHECK (behavior IN ('orchestrator', 'direct', 'direct-with-orchestrator'))";
const COMPLETION_COLUMN: &str = "behavior TEXT NOT NULL CHECK(behavior IN ('orchestrator','direct','direct-with-orchestrator'))";
const INBOX_COLUMN: &str = "completion_source TEXT CHECK (completion_source IN ('traditional_child', 'managed_orchestrator'))";
const ADA_INBOX_COLUMN: &str = "completion_source\n    TEXT CHECK(completion_source IN ('traditional_child','managed_orchestrator'))";

const INBOX_COLUMNS: &[&str] = &[
    "id",
    "session_id",
    "delivery",
    "status",
    "content",
    "target_run_id",
    "client_id",
    "delivered_run_id",
    "created_at",
    "updated_at",
    "delivered_at",
    "cancelled_at",
    "version",
    "admission_id",
    "admission_digest",
    "child_execution_mode",
    "child_wait_id",
    "review_intent",
    "completion_source",
    "completion_session_id",
    "completion_generation",
];
const INBOX_BASE_COLUMNS: usize = 13;

fn replace_once(sql: &str, old: &str, new: &str, table: &str) -> Result<String> {
    if sql.matches(old).count() != 1 || !is_column_definition(sql, old) {
        anyhow::bail!("unexpected {table} schema while tightening direct constraints");
    }
    Ok(sql.replacen(old, new, 1))
}

/// A byte match in sqlite_schema is not evidence of an actual constraint: it
/// can be hidden in a comment, string, quoted identifier, or nested expression.
/// The supported old definition must begin a top-level column of CREATE TABLE.
fn is_column_definition(sql: &str, candidate: &str) -> bool {
    let bytes = sql.as_bytes();
    let mut index = 0;
    let mut depth = 0usize;
    let mut previous = None;
    while index < bytes.len() {
        let byte = bytes[index];
        if depth == 1
            && matches!(previous, Some(b'(' | b','))
            && bytes[index..].starts_with(candidate.as_bytes())
        {
            // Require the entire column definition, not a prefix: an added
            // COLLATE or other suffix could change the CHECK's semantics.
            let tail = &bytes[index + candidate.len()..];
            let next = tail
                .iter()
                .copied()
                .find(|byte| !byte.is_ascii_whitespace());
            return matches!(next, Some(b',' | b')'));
        }
        match byte {
            b'-' if bytes.get(index + 1) == Some(&b'-') => {
                index += 2;
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if bytes.get(index + 1) == Some(&b'*') => {
                index += 2;
                while index + 1 < bytes.len() && &bytes[index..index + 2] != b"*/" {
                    index += 1;
                }
                if index + 1 >= bytes.len() {
                    return false;
                }
                index += 2;
            }
            b'\'' | b'"' | b'`' | b'[' => {
                let terminator = if byte == b'[' { b']' } else { byte };
                index += 1;
                let mut closed = false;
                while index < bytes.len() {
                    if bytes[index] == terminator {
                        if byte != b'[' && bytes.get(index + 1) == Some(&terminator) {
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
                if !closed {
                    return false;
                }
                previous = Some(byte);
            }
            b'(' => {
                depth += 1;
                previous = Some(byte);
                index += 1;
            }
            b')' => {
                let Some(next) = depth.checked_sub(1) else {
                    return false;
                };
                depth = next;
                previous = Some(byte);
                index += 1;
            }
            _ => {
                if !byte.is_ascii_whitespace() {
                    previous = Some(byte);
                }
                index += 1;
            }
        }
    }
    false
}

pub(super) fn tighten(conn: &Connection) -> Result<()> {
    let mut edits = Vec::new();
    let mut normalize_inbox = false;
    for table in [
        "sessions",
        "session_completion_bindings",
        "session_completion_occurrences",
        "session_inbox",
    ] {
        let sql: String = conn.query_row(
            "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?1",
            [table],
            |r| r.get(0),
        )?;
        let updated = match table {
            "sessions" => {
                // Both original inline definitions and historical ALTER TABLE
                // additions are supported, with their exact separator retained.
                let mut variants = Vec::new();
                for default in ["direct", "orchestrator"] {
                    for separator in ["\n                 ", " "] {
                        let old = format!(
                            "behavior TEXT NOT NULL DEFAULT '{default}'{separator}{SESSION_CHECK}"
                        );
                        let new = format!("behavior TEXT NOT NULL DEFAULT 'direct'{separator}CHECK (behavior = 'direct')");
                        if sql.matches(&old).count() == 1 {
                            variants.push((old, new));
                        }
                    }
                }
                if variants.len() != 1 {
                    anyhow::bail!("unexpected sessions behavior definition");
                }
                replace_once(&sql, &variants[0].0, &variants[0].1, table)?
            }
            "session_inbox" => {
                let columns = inbox_columns(conn)?;
                if columns.len() != INBOX_COLUMNS.len()
                    || columns[..INBOX_BASE_COLUMNS]
                        .iter()
                        .map(String::as_str)
                        .collect::<Vec<_>>()
                        != INBOX_COLUMNS[..INBOX_BASE_COLUMNS]
                    || INBOX_COLUMNS[INBOX_BASE_COLUMNS..]
                        .iter()
                        .any(|name| columns.iter().filter(|column| *column == name).count() != 1)
                {
                    anyhow::bail!("unsupported session inbox column layout");
                }
                normalize_inbox =
                    columns.iter().map(String::as_str).collect::<Vec<_>>() != INBOX_COLUMNS;
                if sql.matches(INBOX_COLUMN).count() == 1 && !sql.contains(ADA_INBOX_COLUMN) {
                    if normalize_inbox {
                        validate_inbox_definitions(&sql)?;
                    }
                    replace_once(
                        &sql,
                        INBOX_COLUMN,
                        "completion_source TEXT CHECK (completion_source = 'traditional_child')",
                        table,
                    )?
                } else if sql.matches(ADA_INBOX_COLUMN).count() == 1 && !sql.contains(INBOX_COLUMN)
                {
                    normalize_inbox = true;
                    validate_inbox_definitions(&sql)?;
                    replace_once(&sql, ADA_INBOX_COLUMN, "completion_source\n    TEXT CHECK(completion_source = 'traditional_child')", table)?
                } else {
                    anyhow::bail!("unexpected session inbox origin definition");
                }
            }
            _ => replace_once(
                &sql,
                COMPLETION_COLUMN,
                "behavior TEXT NOT NULL CHECK(behavior = 'direct')",
                table,
            )?,
        };
        edits.push((table, sql, updated));
    }
    for (table, predicate) in [
        ("sessions", "typeof(behavior) <> 'text' OR behavior COLLATE BINARY <> 'direct'"),
        (
            "session_completion_bindings",
            "typeof(behavior) <> 'text' OR behavior COLLATE BINARY <> 'direct'",
        ),
        (
            "session_completion_occurrences",
            "typeof(behavior) <> 'text' OR behavior COLLATE BINARY <> 'direct'",
        ),
        (
            "session_inbox",
            "completion_source IS NOT NULL AND (typeof(completion_source) <> 'text' OR completion_source COLLATE BINARY <> 'traditional_child')",
        ),
    ] {
        let invalid: bool = conn.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE {predicate})"),
            [],
            |r| r.get(0),
        )?;
        if invalid {
            anyhow::bail!("retired or invalid values remain in {table}");
        }
    }
    // Reject modified or absent enforcement triggers rather than silently
    // discarding unknown catalog behavior. Whitespace varies by predecessor.
    for (name, expected) in [
        ("session_direct_only_insert", "CREATE TRIGGER session_direct_only_insert BEFORE INSERT ON sessions WHEN NEW.behavior <> 'direct' BEGIN SELECT RAISE(ABORT, 'retired session behavior'); END"),
        ("session_direct_only_update", "CREATE TRIGGER session_direct_only_update BEFORE UPDATE OF behavior ON sessions WHEN NEW.behavior <> 'direct' BEGIN SELECT RAISE(ABORT, 'retired session behavior'); END"),
        ("session_direct_inbox_origin_insert", "CREATE TRIGGER session_direct_inbox_origin_insert BEFORE INSERT ON session_inbox WHEN NEW.completion_source = 'managed_orchestrator' BEGIN SELECT RAISE(ABORT, 'retired inbox origin'); END"),
        ("session_direct_inbox_origin_update", "CREATE TRIGGER session_direct_inbox_origin_update BEFORE UPDATE OF completion_source ON session_inbox WHEN NEW.completion_source = 'managed_orchestrator' BEGIN SELECT RAISE(ABORT, 'retired inbox origin'); END"),
    ] {
        let sql: String = conn.query_row("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=?1", [name], |r| r.get(0))?;
        if sql.split_whitespace().collect::<Vec<_>>().join(" ") != expected {
            anyhow::bail!("unexpected {name} trigger definition");
        }
    }
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS session_direct_only_insert;
        DROP TRIGGER IF EXISTS session_direct_only_update;
        DROP TRIGGER IF EXISTS session_direct_inbox_origin_insert;
        DROP TRIGGER IF EXISTS session_direct_inbox_origin_update;",
    )?;
    let cookie: i64 = conn.pragma_query_value(None, "schema_version", |r| r.get(0))?;
    let next = cookie
        .checked_add(1)
        .filter(|n| *n <= i32::MAX as i64)
        .ok_or_else(|| anyhow!("SQLite schema cookie exhausted"))?;
    conn.execute_batch("PRAGMA writable_schema=ON")?;
    // Always restore the connection setting before returning even on error.
    // Migration connections are not reused; a failed reset closes the handle.
    let result = (|| -> Result<()> {
        for (table, old, new) in &edits {
            let count = conn.execute(
                "UPDATE sqlite_schema SET sql=?1 WHERE type='table' AND name=?2 AND sql=?3",
                rusqlite::params![new, table, old],
            )?;
            if count != 1 {
                anyhow::bail!("schema changed while updating {table}");
            }
        }
        conn.pragma_update(None, "schema_version", next)?;
        Ok(())
    })();
    let reset = conn.execute_batch("PRAGMA writable_schema=OFF");
    result?;
    reset?;
    if normalize_inbox {
        normalize_inbox_columns(conn)?;
    }
    session_layout::normalize(conn)?;
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if integrity != "ok" {
        anyhow::bail!("SQLite integrity check failed: {integrity}");
    }
    if conn
        .prepare("PRAGMA foreign_key_check")?
        .query([])?
        .next()?
        .is_some()
    {
        anyhow::bail!("foreign key check failed after direct constraint migration");
    }
    Ok(())
}

fn inbox_columns(conn: &Connection) -> Result<Vec<String>> {
    let mut statement = conn.prepare("PRAGMA table_xinfo(session_inbox)")?;
    let columns = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut names = Vec::with_capacity(columns.len());
    for (name, kind, not_null, default, primary_key, hidden) in columns {
        if hidden != 0 {
            anyhow::bail!("unsupported hidden session inbox column {name}");
        }
        let expected_kind = if matches!(name.as_str(), "id" | "version" | "completion_generation") {
            "INTEGER"
        } else {
            "TEXT"
        };
        let expected_not_null = i64::from(matches!(
            name.as_str(),
            "session_id"
                | "delivery"
                | "status"
                | "content"
                | "created_at"
                | "updated_at"
                | "version"
        ));
        let expected_primary_key = i64::from(name == "id");
        let expected_default = match name.as_str() {
            "status" => Some("'pending'"),
            "version" => Some("0"),
            _ => None,
        };
        if !kind.eq_ignore_ascii_case(expected_kind)
            || not_null != expected_not_null
            || primary_key != expected_primary_key
            || default.as_deref() != expected_default
        {
            anyhow::bail!("unsupported session inbox column definition for {name}");
        }
        names.push(name);
    }
    Ok(names)
}

// `table_xinfo` does not expose CHECK constraints or collations. Before
// dropping any additive column, compare its complete top-level definition to
// the known current definition. Ignore formatting whitespace only outside SQL
// quoted values; comments or unusual declarations are not supported shapes.
fn inbox_definitions(sql: &str) -> Result<std::collections::HashMap<String, String>> {
    let bytes = sql.as_bytes();
    let start = bytes
        .iter()
        .position(|b| *b == b'(')
        .context("invalid inbox table definition")?;
    let prefix = sql[..start]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    anyhow::ensure!(
        prefix == "CREATE TABLE session_inbox" || prefix == "CREATE TABLE \"session_inbox\"",
        "unsupported inbox table declaration"
    );
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut index = start + 1;
    let mut depth = 1usize;
    while index < bytes.len() {
        let byte = bytes[index];
        if (byte == b'-' && bytes.get(index + 1) == Some(&b'-'))
            || (byte == b'/' && bytes.get(index + 1) == Some(&b'*'))
        {
            anyhow::bail!("comments in inbox definition are unsupported");
        }
        if matches!(byte, b'\'' | b'"' | b'`' | b'[') {
            let end = if byte == b'[' { b']' } else { byte };
            let begin = index;
            index += 1;
            let mut closed = false;
            while index < bytes.len() {
                if bytes[index] == end {
                    if byte != b'[' && bytes.get(index + 1) == Some(&end) {
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
            anyhow::ensure!(closed, "unterminated inbox SQL quote");
            current.push_str(&sql[begin..index]);
            continue;
        }
        match byte {
            b'(' => {
                depth += 1;
                current.push('(');
            }
            b')' => {
                depth = depth.checked_sub(1).context("invalid inbox SQL nesting")?;
                if depth == 0 {
                    parts.push(current);
                    anyhow::ensure!(
                        sql[index + 1..].trim().is_empty(),
                        "unsupported inbox table suffix"
                    );
                    break;
                }
                current.push(')');
            }
            b',' if depth == 1 => {
                parts.push(std::mem::take(&mut current));
            }
            _ if !byte.is_ascii_whitespace() => current.push(char::from(byte)),
            _ => {}
        }
        index += 1;
    }
    anyhow::ensure!(depth == 0, "incomplete inbox definition");
    let mut definitions = std::collections::HashMap::new();
    for name in &INBOX_COLUMNS[INBOX_BASE_COLUMNS..] {
        let prefix = format!("{name}TEXT");
        let integer_prefix = format!("{name}INTEGER");
        let matches: Vec<_> = parts
            .iter()
            .filter(|part| part.starts_with(&prefix) || part.starts_with(&integer_prefix))
            .collect();
        anyhow::ensure!(
            matches.len() == 1,
            "unsupported inbox column definition for {name}"
        );
        definitions.insert((*name).to_owned(), matches[0].clone());
    }
    Ok(definitions)
}

fn validate_inbox_definitions(sql: &str) -> Result<()> {
    let actual = inbox_definitions(sql)?;
    let canonical = Connection::open_in_memory()?;
    canonical.execute_batch(include_str!("current.sql"))?;
    let current: String = canonical.query_row(
        "SELECT sql FROM sqlite_schema WHERE type='table' AND name='session_inbox'",
        [],
        |row| row.get(0),
    )?;
    let expected = inbox_definitions(&current)?;
    for name in &INBOX_COLUMNS[INBOX_BASE_COLUMNS..] {
        // The old completion source is independently verified and replaced by
        // tighten(); its supported v54 definitions differ from the v56 CHECK.
        if *name != "completion_source" {
            anyhow::ensure!(
                actual.get(*name) == expected.get(*name),
                "unsupported session inbox column definition for {name}"
            );
        }
    }
    Ok(())
}

/// SQLite's DROP COLUMN rewrites each record in place without dropping the
/// parent table, so foreign keys and inbound ON DELETE actions are untouched.
/// Preserve the additive columns transactionally and append their canonical shape.
fn normalize_inbox_columns(conn: &Connection) -> Result<()> {
    let extra_triggers: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE type='trigger' AND tbl_name='session_inbox'",
        [],
        |row| row.get(0),
    )?;
    if extra_triggers != 0 {
        anyhow::bail!("unsupported session inbox triggers while normalizing columns");
    }
    let admission_index: String = conn.query_row(
        "SELECT sql FROM sqlite_schema WHERE type='index' AND name='idx_session_inbox_admission' AND tbl_name='session_inbox'",
        [],
        |row| row.get(0),
    )?;
    if admission_index.split_whitespace().collect::<Vec<_>>().join(" ") != "CREATE UNIQUE INDEX idx_session_inbox_admission ON session_inbox(session_id,admission_id) WHERE admission_id IS NOT NULL" {
        anyhow::bail!("unsupported session inbox admission index");
    }
    let before_sequence: Option<i64> = conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name='session_inbox'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    // Store the temporary snapshot in the same protected database and transaction:
    // review intent can contain sensitive content, so avoid a separate temp file.
    conn.execute_batch(
        "CREATE TABLE nac_v56_inbox_columns AS
           SELECT id,admission_id,admission_digest,child_execution_mode,child_wait_id,review_intent,completion_source,completion_session_id,completion_generation FROM main.session_inbox;
         CREATE UNIQUE INDEX nac_v56_inbox_columns_id ON nac_v56_inbox_columns(id);
         DROP INDEX idx_session_inbox_admission;
         ALTER TABLE session_inbox DROP COLUMN completion_generation;
         ALTER TABLE session_inbox DROP COLUMN completion_session_id;
         ALTER TABLE session_inbox DROP COLUMN completion_source;
         ALTER TABLE session_inbox DROP COLUMN review_intent;
         ALTER TABLE session_inbox DROP COLUMN child_wait_id;
         ALTER TABLE session_inbox DROP COLUMN child_execution_mode;
         ALTER TABLE session_inbox DROP COLUMN admission_digest;
         ALTER TABLE session_inbox DROP COLUMN admission_id;
         ALTER TABLE session_inbox ADD COLUMN admission_id TEXT CHECK (admission_id IS NULL OR length(admission_id)=36);
         ALTER TABLE session_inbox ADD COLUMN admission_digest TEXT CHECK ((admission_digest IS NULL) = (admission_id IS NULL)) CHECK (admission_digest IS NULL OR (length(admission_digest)=64 AND admission_digest NOT GLOB '*[^0-9a-f]*'));
         ALTER TABLE session_inbox ADD COLUMN child_execution_mode TEXT CHECK (child_execution_mode IN ('foreground', 'background'));
         ALTER TABLE session_inbox ADD COLUMN child_wait_id TEXT CHECK (child_wait_id IS NULL OR length(child_wait_id) = 36);
         ALTER TABLE session_inbox ADD COLUMN review_intent TEXT;
         ALTER TABLE session_inbox ADD COLUMN completion_source TEXT CHECK (completion_source = 'traditional_child');
         ALTER TABLE session_inbox ADD COLUMN completion_session_id TEXT CHECK ((completion_session_id IS NULL) = (completion_source IS NULL));
         ALTER TABLE session_inbox ADD COLUMN completion_generation INTEGER CHECK ((completion_generation IS NULL) = (completion_source IS NULL)) CHECK (completion_generation IS NULL OR completion_generation > 0);
         UPDATE session_inbox SET (admission_id,admission_digest,child_execution_mode,child_wait_id,review_intent,completion_source,completion_session_id,completion_generation) =
           (SELECT admission_id,admission_digest,child_execution_mode,child_wait_id,review_intent,completion_source,completion_session_id,completion_generation FROM main.nac_v56_inbox_columns WHERE id=session_inbox.id);
         CREATE UNIQUE INDEX idx_session_inbox_admission ON session_inbox(session_id,admission_id) WHERE admission_id IS NOT NULL;",
    )?;
    let mismatches: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM session_inbox i LEFT JOIN main.nac_v56_inbox_columns o ON o.id=i.id
          WHERE o.id IS NULL OR i.admission_id IS NOT o.admission_id OR i.admission_digest IS NOT o.admission_digest OR i.child_execution_mode IS NOT o.child_execution_mode OR i.child_wait_id IS NOT o.child_wait_id OR i.review_intent IS NOT o.review_intent OR i.completion_source IS NOT o.completion_source OR i.completion_session_id IS NOT o.completion_session_id OR i.completion_generation IS NOT o.completion_generation OR typeof(i.admission_id) <> typeof(o.admission_id) OR typeof(i.admission_digest) <> typeof(o.admission_digest) OR typeof(i.child_execution_mode) <> typeof(o.child_execution_mode) OR typeof(i.child_wait_id) <> typeof(o.child_wait_id) OR typeof(i.review_intent) <> typeof(o.review_intent) OR typeof(i.completion_source) <> typeof(o.completion_source) OR typeof(i.completion_session_id) <> typeof(o.completion_session_id) OR typeof(i.completion_generation) <> typeof(o.completion_generation))
          OR (SELECT count(*) FROM session_inbox) <> (SELECT count(*) FROM main.nac_v56_inbox_columns)", [], |row| row.get(0),
    )?;
    let after_sequence: Option<i64> = conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name='session_inbox'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if mismatches
        || after_sequence != before_sequence
        || inbox_columns(conn)?
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            != INBOX_COLUMNS
    {
        anyhow::bail!("session inbox columns or identity changed during normalization");
    }
    conn.execute_batch("DROP TABLE main.nac_v56_inbox_columns")?;
    Ok(())
}

#[cfg(test)]
#[path = "direct_constraints_tests.rs"]
mod tests;
