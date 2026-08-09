use super::*;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct RespondLivePreference {
    pub enabled: bool,
    pub version: u64,
}

#[derive(Debug)]
pub enum UpdateRespondLiveError {
    SessionNotFound(String),
    VersionConflict { expected: u64, current: u64 },
    Store(anyhow::Error),
}

impl std::fmt::Display for UpdateRespondLiveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SessionNotFound(id) => write!(formatter, "session '{id}' was not found"),
            Self::VersionConflict { expected, current } => write!(
                formatter,
                "respond-live preference version conflict (expected {expected}, current {current})"
            ),
            Self::Store(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for UpdateRespondLiveError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Store(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<anyhow::Error> for UpdateRespondLiveError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

pub fn load_respond_live_preference(
    path: &Path,
    session_id: &str,
) -> Result<RespondLivePreference> {
    let conn = open_runtime_connection(path)?;
    let row = conn
        .query_row(
            "SELECT respond_live, version FROM session_preferences WHERE session_id = ?1",
            params![session_id],
            |row| Ok((row.get::<_, bool>(0)?, row.get::<_, u64>(1)?)),
        )
        .optional()?;
    Ok(row
        .map(|(enabled, version)| RespondLivePreference { enabled, version })
        .unwrap_or_default())
}

pub fn update_respond_live_preference(
    path: &Path,
    session_id: &str,
    enabled: bool,
    expected_version: u64,
) -> std::result::Result<RespondLivePreference, UpdateRespondLiveError> {
    let mut conn = open_runtime_connection(path).map_err(anyhow::Error::from)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(anyhow::Error::from)?;
    let exists = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = ?1)",
            params![session_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(anyhow::Error::from)?;
    if !exists {
        return Err(UpdateRespondLiveError::SessionNotFound(
            session_id.to_string(),
        ));
    }
    let current = tx
        .query_row(
            "SELECT version FROM session_preferences WHERE session_id = ?1",
            params![session_id],
            |row| row.get::<_, u64>(0),
        )
        .optional()
        .map_err(anyhow::Error::from)?
        .unwrap_or(0);
    if current != expected_version {
        return Err(UpdateRespondLiveError::VersionConflict {
            expected: expected_version,
            current,
        });
    }
    let version = current
        .checked_add(1)
        .ok_or_else(|| anyhow!("respond-live preference version overflow"))?;
    tx.execute(
        "INSERT INTO session_preferences (session_id, respond_live, version)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET
             respond_live = excluded.respond_live, version = excluded.version",
        params![session_id, enabled, version],
    )
    .map_err(anyhow::Error::from)?;
    tx.commit().map_err(anyhow::Error::from)?;
    Ok(RespondLivePreference { enabled, version })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_defaults_off_and_updates_use_cas() {
        let path =
            std::env::temp_dir().join(format!("nac_preferences_{}.db", uuid::Uuid::new_v4()));
        initialize(&path).unwrap();
        insert_test_session(&path, "owned");
        assert_eq!(
            load_respond_live_preference(&path, "owned").unwrap(),
            RespondLivePreference::default()
        );
        let updated = update_respond_live_preference(&path, "owned", true, 0).unwrap();
        assert_eq!(
            updated,
            RespondLivePreference {
                enabled: true,
                version: 1
            }
        );
        assert!(matches!(
            update_respond_live_preference(&path, "owned", false, 0),
            Err(UpdateRespondLiveError::VersionConflict { current: 1, .. })
        ));
        assert_eq!(
            load_respond_live_preference(&path, "owned").unwrap(),
            updated
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn update_rejects_missing_session() {
        let path = std::env::temp_dir().join(format!(
            "nac_preferences_missing_{}.db",
            uuid::Uuid::new_v4()
        ));
        initialize(&path).unwrap();
        assert!(matches!(
            update_respond_live_preference(&path, "missing", true, 0),
            Err(UpdateRespondLiveError::SessionNotFound(_))
        ));
        let _ = std::fs::remove_file(path);
    }
}
