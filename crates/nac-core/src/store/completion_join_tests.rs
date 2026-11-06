//! Current scheduler goal admission and semantic completion share one transaction.
use super::*;

#[test]
fn join_shared_goal_bind_rolls_back_completion_participation_with_outer_admission() {
    let mut f = Fixture::new("direct");
    let cutoff = f.cursor();
    f.begin("joined-run");
    let goal = create_session_goal(&f.path, "session", "scheduled goal", None, None).unwrap();
    let mut conn = open_runtime_connection(&f.path).unwrap();
    for commit in [false, true] {
        let tx = conn.transaction().unwrap();
        let bound = crate::store::session_goals::bind_session_goal_run_with_connection(
            &tx,
            "session",
            &f.baseline("joined-run"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(bound.goal_id, goal.goal_id);
        let participates: bool = tx
            .query_row(
                "SELECT goal_participated FROM session_completion_bindings
                 WHERE session_id='session' AND run_id='joined-run'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            participates,
            "connection-scoped admission lost completion binding"
        );
        if commit {
            tx.commit().unwrap();
        } else {
            tx.rollback().unwrap();
            assert_eq!(
                load_session_goal(&f.path, "session").unwrap(),
                Some(goal.clone())
            );
            assert!(!conn
                .query_row::<bool, _, _>(
                    "SELECT goal_participated FROM session_completion_bindings
                     WHERE session_id='session' AND run_id='joined-run'",
                    [],
                    |row| row.get(0),
                )
                .unwrap());
        }
    }
    drop(conn);
    let mark =
        update_session_goal_by_model(&f.path, "session", &goal.goal_id, GoalStatus::Complete)
            .unwrap();
    f.finish("joined-run");
    initialize(&f.path).unwrap();
    f.finish("joined-run");
    let page = read_completion_page(&f.path, Some(&cutoff)).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].kind, CompletionKind::Goal);
    assert_eq!(
        page.items[0].goal_id.as_deref(),
        Some(goal.goal_id.as_str())
    );
    assert_eq!(page.items[0].mark_version, Some(mark.version));
}
