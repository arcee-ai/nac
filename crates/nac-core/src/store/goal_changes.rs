//! Lossy post-commit goal/question hints, never history or outcome authority.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use tokio::sync::broadcast;

use super::{GoalStatus, SessionGoalRecord};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GoalChangeKind {
    Current,
    Replaced,
    Cleared,
}

#[derive(Clone, Debug)]
pub(crate) struct GoalChange {
    pub store_path: PathBuf,
    pub session_id: String,
    pub goal_id: String,
    pub version: i64,
    pub status: GoalStatus,
    pub kind: GoalChangeKind,
}

#[derive(Clone, Debug)]
pub(crate) enum TaskChange {
    Goal(GoalChange),
    Question {
        store_path: PathBuf,
        session_id: String,
        run_id: String,
        goal_id: Option<String>,
    },
}

pub(crate) fn question_committed(path: &Path, question: &super::QuestionRecord) {
    let changes = CHANGES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(sender) = changes.get(path) {
        let _ = sender.send(TaskChange::Question {
            store_path: path.to_path_buf(),
            session_id: question.request.session_id.clone(),
            run_id: question.request.run_id.clone(),
            goal_id: question.goal_id.clone(),
        });
    }
}

// Bounded process-local delivery only. A lagged receiver, foreign owner or
// restart must re-read the store; none of these hints prove completion.
static CHANGES: LazyLock<Mutex<HashMap<PathBuf, broadcast::Sender<TaskChange>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) fn subscribe(path: &Path) -> broadcast::Receiver<TaskChange> {
    let mut changes = CHANGES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    changes.retain(|_, sender| sender.receiver_count() > 0);
    changes
        .entry(path.to_path_buf())
        .or_insert_with(|| broadcast::channel(256).0)
        .subscribe()
}

#[cfg(test)]
pub(crate) fn subscriber_count(path: &Path) -> usize {
    CHANGES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(path)
        .map_or(0, broadcast::Sender::receiver_count)
}

pub(crate) fn committed(path: &Path, goal: &SessionGoalRecord, kind: GoalChangeKind) {
    let changes = CHANGES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let Some(sender) = changes.get(path) else {
        return;
    };
    let _ = sender.send(TaskChange::Goal(GoalChange {
        store_path: path.to_path_buf(),
        session_id: goal.session_id.clone(),
        goal_id: goal.goal_id.clone(),
        version: goal.version,
        status: goal.status,
        kind,
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store;

    #[tokio::test]
    async fn committed_identity_versions_and_retirement_revalidate_from_one_owner() {
        let path = std::env::temp_dir()
            .join(format!("nac-goal-hints-{}", uuid::Uuid::new_v4()))
            .join("store.db");
        store::initialize(&path).unwrap();
        store::insert_test_session(&path, "direct");
        let conn = store::open_runtime_connection(&path).unwrap();
        conn.execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'direct'",
            [],
        )
        .unwrap();
        let mut hints = subscribe(&path);
        let goal = store::create_session_goal(&path, "direct", "first", None, None).unwrap();
        let next = async |hints: &mut broadcast::Receiver<TaskChange>| loop {
            if let TaskChange::Goal(hint) = hints.recv().await.unwrap() {
                if hint.store_path == path {
                    break hint;
                }
            }
        };
        let created = next(&mut hints).await;
        assert_eq!(created.goal_id, goal.goal_id);
        assert_eq!(created.version, goal.version);
        assert_eq!(created.kind, GoalChangeKind::Current);
        assert_eq!(
            store::load_session_goal(&path, "direct").unwrap().unwrap(),
            goal
        );
        assert!(store::update_session_goal_by_user(
            &path,
            "direct",
            &goal.goal_id,
            goal.version + 1,
            store::UserGoalUpdate {
                status: Some(GoalStatus::Paused),
                ..Default::default()
            }
        )
        .is_err());
        let completed = store::update_session_goal_by_model(
            &path,
            "direct",
            &goal.goal_id,
            GoalStatus::Complete,
        )
        .unwrap();
        assert_eq!(next(&mut hints).await.version, completed.version);
        let replacement =
            store::create_session_goal(&path, "direct", "second", None, None).unwrap();
        let retired = next(&mut hints).await;
        assert_eq!(retired.goal_id, goal.goal_id);
        assert_eq!(retired.kind, GoalChangeKind::Replaced);
        assert_eq!(retired.status, GoalStatus::Complete);
        assert_eq!(next(&mut hints).await.goal_id, replacement.goal_id);
        store::clear_session_goal(&path, "direct", &replacement.goal_id, replacement.version)
            .unwrap();
        assert_eq!(next(&mut hints).await.kind, GoalChangeKind::Cleared);
        assert!(store::load_session_goal(&path, "direct").unwrap().is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
