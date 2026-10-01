//! Bounded migration observations and credential-free operational status.
use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreMigrationState {
    Migrating,
    Current,
    Required,
    Failed,
}

impl StoreMigrationState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Migrating => "migrating",
            Self::Current => "current",
            Self::Required => "migration-required",
            Self::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreMigrationFailure {
    FutureSchema,
    InvalidSchema,
    MigrationFailed,
    StoreUnavailable,
}

impl StoreMigrationFailure {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FutureSchema => "future-schema",
            Self::InvalidSchema => "invalid-schema",
            Self::MigrationFailed => "migration-failed",
            Self::StoreUnavailable => "store-unavailable",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreMigrationStatus {
    pub supported_schema_version: i64,
    pub opened_schema_version: Option<i64>,
    pub state: StoreMigrationState,
    pub failure: Option<StoreMigrationFailure>,
}

const MIGRATION_OBSERVATION_LIMIT: usize = 128;

#[derive(Debug, Clone, Copy)]
struct MigrationObservation {
    active: usize,
    status: StoreMigrationStatus,
}

static MIGRATION_OBSERVATIONS: std::sync::LazyLock<Mutex<HashMap<PathBuf, MigrationObservation>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) fn begin_migration(path: &Path, status: StoreMigrationStatus) {
    let mut observations = MIGRATION_OBSERVATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !observations.contains_key(path) {
        prune_inactive_observations(&mut observations, MIGRATION_OBSERVATION_LIMIT - 1, None);
    }
    let observation = observations
        .entry(path.to_path_buf())
        .or_insert(MigrationObservation { active: 0, status });
    observation.active += 1;
    observation.status = status;
}

pub(super) fn finish_migration(path: &Path, status: StoreMigrationStatus) {
    let mut observations = MIGRATION_OBSERVATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(observation) = observations.get_mut(path) else {
        debug_assert!(false, "migration completion must match its start");
        return;
    };
    if observation.active == 0 {
        debug_assert!(false, "migration observation active count underflow");
        return;
    }
    observation.active -= 1;
    if status.state == StoreMigrationState::Current && observation.active == 0 {
        observations.remove(path);
        return;
    }
    observation.status = if status.state == StoreMigrationState::Current {
        StoreMigrationStatus {
            state: StoreMigrationState::Migrating,
            ..status
        }
    } else {
        status
    };
    prune_inactive_observations(&mut observations, MIGRATION_OBSERVATION_LIMIT, Some(path));
}

fn prune_inactive_observations(
    observations: &mut HashMap<PathBuf, MigrationObservation>,
    maximum: usize,
    preserve: Option<&Path>,
) {
    while observations.len() > maximum {
        let Some(expired) = observations.iter().find_map(|(candidate, observation)| {
            (preserve != Some(candidate.as_path()) && observation.active == 0)
                .then(|| candidate.clone())
        }) else {
            break;
        };
        observations.remove(&expired);
    }
}

#[cfg(test)]
pub(super) fn has_migration_observation(path: &Path) -> bool {
    let Ok(path) = std::fs::canonicalize(path) else {
        return false;
    };
    MIGRATION_OBSERVATIONS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .contains_key(&path)
}

/// Inspect exact schema/migration state without applying a migration. Failure
/// details are deliberately categorical so paths, SQL, and stored data cannot
/// cross an operational status boundary.
pub fn migration_status(path: &Path) -> StoreMigrationStatus {
    match crate::store::coordinator::owner_for(path) {
        Ok(Some(owner)) => {
            return owner
                .check_blocking_context()
                .and_then(|()| owner.submit(MigrationStatusCommand))
                .and_then(crate::store::coordinator::PendingPersistence::acknowledge_blocking)
                .unwrap_or_else(|_| unavailable_status())
        }
        Err(_) => return unavailable_status(),
        Ok(None) => {}
    }

    let Ok(path) = std::fs::canonicalize(path) else {
        return StoreMigrationStatus {
            supported_schema_version: STORE_SCHEMA_VERSION,
            opened_schema_version: None,
            state: StoreMigrationState::Failed,
            failure: Some(StoreMigrationFailure::StoreUnavailable),
        };
    };
    let Some(opened_schema_version) = read_opened_schema_version(&path) else {
        return StoreMigrationStatus {
            supported_schema_version: STORE_SCHEMA_VERSION,
            opened_schema_version: None,
            state: StoreMigrationState::Failed,
            failure: Some(StoreMigrationFailure::StoreUnavailable),
        };
    };
    if opened_schema_version > STORE_SCHEMA_VERSION {
        return StoreMigrationStatus {
            supported_schema_version: STORE_SCHEMA_VERSION,
            opened_schema_version: Some(opened_schema_version),
            state: StoreMigrationState::Failed,
            failure: Some(StoreMigrationFailure::FutureSchema),
        };
    }
    {
        let mut observations = MIGRATION_OBSERVATIONS
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(observed) = observations.get(&path).copied() {
            if matches!(
                observed.status.state,
                StoreMigrationState::Migrating | StoreMigrationState::Failed
            ) && observed.status.opened_schema_version == Some(opened_schema_version)
            {
                return observed.status;
            }
            if observed.active == 0 {
                observations.remove(&path);
            }
        }
    }
    if opened_schema_version < STORE_SCHEMA_VERSION {
        return StoreMigrationStatus {
            supported_schema_version: STORE_SCHEMA_VERSION,
            opened_schema_version: Some(opened_schema_version),
            state: StoreMigrationState::Required,
            failure: None,
        };
    }
    let schema_valid = connect_existing(&path)
        .and_then(|connection| {
            connection
                .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions')",
            [],
            |row| row.get::<_, bool>(0),
        )
                .map_err(anyhow::Error::from)
        })
        .unwrap_or(false);
    StoreMigrationStatus {
        supported_schema_version: STORE_SCHEMA_VERSION,
        opened_schema_version: Some(opened_schema_version),
        state: if schema_valid {
            StoreMigrationState::Current
        } else {
            StoreMigrationState::Failed
        },
        failure: (!schema_valid).then_some(StoreMigrationFailure::InvalidSchema),
    }
}

fn unavailable_status() -> StoreMigrationStatus {
    StoreMigrationStatus {
        supported_schema_version: STORE_SCHEMA_VERSION,
        opened_schema_version: None,
        state: StoreMigrationState::Failed,
        failure: Some(StoreMigrationFailure::StoreUnavailable),
    }
}
struct MigrationStatusCommand;
impl crate::store::coordinator::PersistenceCommand for MigrationStatusCommand {
    type Output = StoreMigrationStatus;
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::default()
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        Ok(migration_status(path))
    }
}
impl crate::store::StoreCoordinator {
    pub async fn migration_status(&self) -> Result<StoreMigrationStatus> {
        self.submit(MigrationStatusCommand)?.acknowledge().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_observation_retention_is_bounded_without_evicting_active_work() {
        let status = StoreMigrationStatus {
            supported_schema_version: STORE_SCHEMA_VERSION,
            opened_schema_version: Some(23),
            state: StoreMigrationState::Failed,
            failure: Some(StoreMigrationFailure::MigrationFailed),
        };
        let mut observations = HashMap::new();
        for index in 0..(MIGRATION_OBSERVATION_LIMIT + 10) {
            observations.insert(
                PathBuf::from(format!("failed-{index}")),
                MigrationObservation { active: 0, status },
            );
        }
        let active_path = PathBuf::from("active");
        observations.insert(
            active_path.clone(),
            MigrationObservation {
                active: 1,
                status: StoreMigrationStatus {
                    state: StoreMigrationState::Migrating,
                    failure: None,
                    ..status
                },
            },
        );

        prune_inactive_observations(&mut observations, MIGRATION_OBSERVATION_LIMIT, None);

        assert_eq!(observations.len(), MIGRATION_OBSERVATION_LIMIT);
        assert_eq!(observations[&active_path].active, 1);
    }
}
