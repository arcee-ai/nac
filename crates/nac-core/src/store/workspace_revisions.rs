use super::*;

/// One captured state of a session's checkout.
///
/// The heavy part of a revision — the files — lives in the repository as a git
/// commit; this row is only the bookkeeping that tells us which commit belongs
/// to which run, and what it should be compared against.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct WorkspaceRevisionRecord {
    pub id: i64,
    pub session_id: String,
    pub run_id: String,
    pub commit_sha: String,
    /// The commit this revision is shown as a change against.
    #[cfg_attr(feature = "openapi", schema(required))]
    pub base_sha: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub branch: Option<String>,
    /// Prompt that started the run, for telling revisions apart in a list.
    pub label: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub created_at: String,
    /// How many transcript messages the session had when this revision was
    /// taken — the link that lets a revert ask "what did the checkout look
    /// like at this point in the conversation". `None` on rows written before
    /// the column existed.
    #[serde(default)]
    #[cfg_attr(feature = "openapi", schema(required))]
    pub transcript_len: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewWorkspaceRevision {
    pub run_id: String,
    pub commit_sha: String,
    pub base_sha: Option<String>,
    pub branch: Option<String>,
    pub label: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub transcript_len: Option<u64>,
}

pub fn append_workspace_revision(
    path: &Path,
    session_id: &str,
    revision: NewWorkspaceRevision,
) -> Result<WorkspaceRevisionRecord> {
    if session_id.trim().is_empty() {
        return Err(anyhow!("session id is empty"));
    }

    let conn = open_runtime_connection(path)?;
    let created_at = now_utc();
    conn.execute(
        "INSERT INTO workspace_revisions
         (session_id, run_id, commit_sha, base_sha, branch, label,
          additions, deletions, changed_files, created_at, transcript_len)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            session_id,
            revision.run_id,
            revision.commit_sha,
            revision.base_sha,
            revision.branch,
            revision.label,
            revision.additions,
            revision.deletions,
            revision.changed_files,
            created_at,
            revision.transcript_len,
        ],
    )?;

    Ok(WorkspaceRevisionRecord {
        id: conn.last_insert_rowid(),
        session_id: session_id.to_string(),
        run_id: revision.run_id,
        commit_sha: revision.commit_sha,
        base_sha: revision.base_sha,
        branch: revision.branch,
        label: revision.label,
        additions: revision.additions,
        deletions: revision.deletions,
        changed_files: revision.changed_files,
        created_at,
        transcript_len: revision.transcript_len,
    })
}

/// Newest first, which is the order the picker shows them in.
pub fn list_workspace_revisions(
    path: &Path,
    session_id: &str,
) -> Result<Vec<WorkspaceRevisionRecord>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn.prepare(
        "SELECT id, session_id, run_id, commit_sha, base_sha, branch, label,
                additions, deletions, changed_files, created_at, transcript_len
         FROM workspace_revisions
         WHERE session_id = ?1
         ORDER BY id DESC",
    )?;
    let rows = statement.query_map(params![session_id], decode_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn read_workspace_revision(
    path: &Path,
    session_id: &str,
    id: i64,
) -> Result<Option<WorkspaceRevisionRecord>> {
    let conn = open_runtime_connection(path)?;
    Ok(conn
        .query_row(
            "SELECT id, session_id, run_id, commit_sha, base_sha, branch, label,
                    additions, deletions, changed_files, created_at, transcript_len
             FROM workspace_revisions
             WHERE session_id = ?1 AND id = ?2",
            params![session_id, id],
            decode_row,
        )
        .optional()?)
}

pub fn latest_workspace_revision(
    path: &Path,
    session_id: &str,
) -> Result<Option<WorkspaceRevisionRecord>> {
    let conn = open_runtime_connection(path)?;
    Ok(conn
        .query_row(
            "SELECT id, session_id, run_id, commit_sha, base_sha, branch, label,
                    additions, deletions, changed_files, created_at, transcript_len
             FROM workspace_revisions
             WHERE session_id = ?1
             ORDER BY id DESC
             LIMIT 1",
            params![session_id],
            decode_row,
        )
        .optional()?)
}

pub fn workspace_revision_for_run(
    path: &Path,
    session_id: &str,
    run_id: &str,
) -> Result<Option<WorkspaceRevisionRecord>> {
    let conn = open_runtime_connection(path)?;
    Ok(conn
        .query_row(
            "SELECT id, session_id, run_id, commit_sha, base_sha, branch, label,
                    additions, deletions, changed_files, created_at, transcript_len
             FROM workspace_revisions
             WHERE session_id = ?1 AND run_id = ?2
             ORDER BY id DESC
             LIMIT 1",
            params![session_id, run_id],
            decode_row,
        )
        .optional()?)
}

/// The newest revision that describes a transcript no longer than
/// `transcript_len` — the checkout as it stood at that point in the
/// conversation. Rows without a recorded length predate the link and are
/// skipped rather than guessed at.
pub fn workspace_revision_at_transcript_len(
    path: &Path,
    session_id: &str,
    transcript_len: u64,
) -> Result<Option<WorkspaceRevisionRecord>> {
    let conn = open_runtime_connection(path)?;
    Ok(conn
        .query_row(
            "SELECT id, session_id, run_id, commit_sha, base_sha, branch, label,
                    additions, deletions, changed_files, created_at, transcript_len
             FROM workspace_revisions
             WHERE session_id = ?1
               AND transcript_len IS NOT NULL
               AND transcript_len <= ?2
             ORDER BY id DESC
             LIMIT 1",
            params![session_id, transcript_len],
            decode_row,
        )
        .optional()?)
}

/// Forget every revision newer than `keep_through_id`, or all of them when it
/// is `None`. A revert rewinds the checkout, so the revisions taken after that
/// point no longer describe anything the session can reach.
pub fn delete_workspace_revisions_after(
    path: &Path,
    session_id: &str,
    keep_through_id: Option<i64>,
) -> Result<usize> {
    let conn = open_runtime_connection(path)?;
    let deleted = conn.execute(
        "DELETE FROM workspace_revisions
         WHERE session_id = ?1 AND id > ?2",
        params![session_id, keep_through_id.unwrap_or(0)],
    )?;
    Ok(deleted)
}

fn decode_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceRevisionRecord> {
    Ok(WorkspaceRevisionRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        run_id: row.get(2)?,
        commit_sha: row.get(3)?,
        base_sha: row.get(4)?,
        branch: row.get(5)?,
        label: row.get(6)?,
        additions: row.get(7)?,
        deletions: row.get(8)?,
        changed_files: row.get(9)?,
        created_at: row.get(10)?,
        transcript_len: row.get(11)?,
    })
}
