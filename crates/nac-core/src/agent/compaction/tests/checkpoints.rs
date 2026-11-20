use super::super::*;
use super::{assistant, candidate, state, temp_store_path, user};

use crate::store;
use crate::store::session_compaction::{
    append_session_compaction_checkpoint, NewSessionCompactionCheckpoint,
};
use crate::types::{FunctionCall, Message, ToolCall};

fn as_transcript(messages: &[Message]) -> crate::agent::TranscriptMessages {
    messages.to_vec().into()
}

#[test]
fn restore_falls_back_from_newest_invalid_checkpoint() {
    let path = temp_store_path("fallback");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![
        user("old"),
        assistant("answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let valid = append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("valid"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: Some(valid.id),
            summary: installed_summary("invalid newest"),
            tail_start_message_index: 3,
            source_prefix_sha256: [9; 32],
            system_policy_sha256: policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();

    let mut state = state(path.clone(), None);
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, valid.id);
    let view = state
        .plan(&as_transcript(&messages), &[], CompactionReason::Auto)
        .prepared
        .messages;
    assert!(serde_json::to_string(&view).unwrap().contains("valid"));
    assert!(!serde_json::to_string(&view)
        .unwrap()
        .contains("invalid newest"));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn checkpoint_refresh_preserves_sample_for_same_projection_and_invalidates_changed_checkpoint() {
    let path = temp_store_path("sample_refresh");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![
        user("old"),
        assistant("answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let first = append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("first summary"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 500,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let mut state = state(path.clone(), Some(1_000));
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    state.record_ordinary_context(
        &as_transcript(&messages),
        50,
        messages.len(),
        Some(first.id),
    );

    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(
        state
            .plan(&as_transcript(&messages), &[], CompactionReason::Auto)
            .prepared
            .context_estimate,
        50
    );

    let mut changed_projection = messages.clone();
    changed_projection[3] = user("changed current");
    state
        .restore_newest_valid_checkpoint(&changed_projection)
        .unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, first.id);
    let prepared = state
        .plan(
            &as_transcript(&changed_projection),
            &[],
            CompactionReason::Auto,
        )
        .prepared;
    assert_eq!(
        prepared.context_estimate,
        estimate_message_tokens(&prepared.messages).saturating_add(estimate_tool_tokens(&[]))
    );

    state.restore_newest_valid_checkpoint(&messages).unwrap();
    state.record_ordinary_context(
        &as_transcript(&messages),
        50,
        messages.len(),
        Some(first.id),
    );
    let (source, policy) = checkpoint_digests(&messages, 3);
    let second = append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: Some(first.id),
            summary: installed_summary("changed summary"),
            tail_start_message_index: 3,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 500,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 40,
        },
    )
    .unwrap();
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, second.id);
    let prepared = state
        .plan(&as_transcript(&messages), &[], CompactionReason::Auto)
        .prepared;
    assert_eq!(
        prepared.context_estimate,
        estimate_message_tokens(&prepared.messages).saturating_add(estimate_tool_tokens(&[]))
    );
    assert_ne!(prepared.context_estimate, 50);

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn wrapper_only_checkpoint_falls_back_to_older_valid_row() {
    let path = temp_store_path("wrapper_only");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![
        user("old"),
        assistant("answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let valid = append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("valid"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let (source, policy) = checkpoint_digests(&messages, 3);
    append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: Some(valid.id),
            summary: HISTORICAL_CONTEXT_PREFIX.to_string(),
            tail_start_message_index: 3,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();

    let mut state = state(path.clone(), None);
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, valid.id);
    let view = state
        .plan(&as_transcript(&messages), &[], CompactionReason::Auto)
        .prepared;
    assert!(serde_json::to_string(&view.messages)
        .unwrap()
        .contains("valid"));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn repaired_transcript_clears_stale_checkpoint_before_candidate_and_sample_use() {
    let path = temp_store_path("repaired");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let mut messages = vec![
        user("old"),
        assistant("answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let checkpoint = append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("stale summary"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let mut state = state(path.clone(), Some(1));
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    state.record_ordinary_context(
        &as_transcript(&messages),
        50,
        messages.len(),
        Some(checkpoint.id),
    );

    messages[1] = assistant("repaired answer");
    let candidate = candidate(state.plan(&as_transcript(&messages), &[], CompactionReason::Auto));
    assert_eq!(candidate.previous_checkpoint_id, None);
    let encoded = serde_json::to_string(&candidate.summary_messages).unwrap();
    assert!(encoded.contains("repaired answer"));
    assert!(!encoded.contains("stale summary"));
    assert!(state.active_checkpoint_for_test().is_none());
    assert!(
        state
            .plan(&as_transcript(&messages), &[], CompactionReason::Auto)
            .prepared
            .context_estimate
            != 50
    );

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn restore_accepts_legacy_user_assistant_and_end_boundaries_but_rejects_unsafe_positions() {
    let messages = vec![
        user("old"),
        assistant("first"),
        user("middle"),
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![ToolCall {
                id: "call".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "tool".to_string(),
                    arguments: "{}".to_string(),
                },
            }]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Tool {
            tool_call_id: "call".to_string(),
            content: "result".into(),
        },
    ];
    for (label, boundary) in [("user", 2), ("assistant", 3), ("end", messages.len())] {
        let path = temp_store_path(label);
        store::initialize(&path).unwrap();
        store::insert_test_session(&path, "session");
        let (source, policy) = checkpoint_digests(&messages, boundary);
        let checkpoint = append_session_compaction_checkpoint(
            &path,
            &NewSessionCompactionCheckpoint {
                session_id: "session".to_string(),
                previous_checkpoint_id: None,
                summary: installed_summary(label),
                tail_start_message_index: boundary,
                source_prefix_sha256: source,
                system_policy_sha256: policy,
                prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
                old_context_estimate: 100,
                summary_prompt_tokens: None,
                summary_completion_tokens: None,
                new_context_estimate: 50,
            },
        )
        .unwrap();
        let mut state = state(path.clone(), None);
        state.restore_newest_valid_checkpoint(&messages).unwrap();
        assert_eq!(
            state.active_checkpoint_for_test().unwrap().id,
            checkpoint.id
        );

        if boundary == messages.len() {
            let mut appended = messages.clone();
            appended.push(user("later"));
            appended.push(assistant("later answer"));
            state.restore_newest_valid_checkpoint(&appended).unwrap();
            assert_eq!(
                state.active_checkpoint_for_test().unwrap().id,
                checkpoint.id
            );
            state.record_ordinary_context(
                &as_transcript(&appended),
                20,
                appended.len(),
                Some(checkpoint.id),
            );
            assert_eq!(
                state
                    .prepare(&as_transcript(&appended), &[])
                    .context_estimate,
                20
            );
        }
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    assert!(!checkpoint_boundary_is_valid(&messages, 4));
    assert!(!checkpoint_boundary_is_valid(&messages, 1_000));
    let with_system = vec![
        user("old"),
        Message::System {
            content: "policy".to_string(),
        },
    ];
    assert!(!checkpoint_boundary_is_valid(&with_system, 1));
    assert!(!summarized_prefix_has_complete_tools(&messages, 4));
}

#[test]
fn migrated_child_checkpoint_restores_after_prompt_transition_and_stale_falls_back() {
    use sha2::{Digest, Sha256};
    fn update_bytes(hash: &mut Sha256, bytes: &[u8]) {
        hash.update((bytes.len() as u64).to_be_bytes());
        hash.update(bytes);
    }
    let path = temp_store_path("v54_child_prompt");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(include_str!("../../../store/schema/fixtures/v53-fresh.sql"))
        .unwrap();
    let description = "child description mentioning orchestrator";
    let suffix = "\n\nProject instructions with literal orchestrator wording.";
    let old_template = include_str!("../../../store/schema/fixtures/v54-direct-child.md");
    let old_system = format!(
        "{}{}",
        old_template
            .replace("{working_directory}", "/tmp/project")
            .replace("{description}", description),
        suffix
    );
    let old_messages = vec![
        Message::System {
            content: old_system,
        },
        user("preserved user text"),
        user("recent"),
    ];
    let json = serde_json::to_string(&old_messages).unwrap();
    for (id, snapshot) in [("parent", "[]"), ("child", json.as_str())] {
        conn.execute("INSERT INTO sessions(session_id,behavior,cwd,store_path,model,base_url,messages_json,created_at,updated_at) VALUES(?1,'direct','/tmp/project',?2,'test','https://example.invalid',?3,'now','now')", rusqlite::params![id,path.display().to_string(),snapshot]).unwrap();
    }
    conn.execute("INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,created_at,updated_at) VALUES('child','parent','parent','general',?1,1,'idle',0,'now','now')", [description]).unwrap();
    let boundary = 2_usize;
    let mut source = Sha256::new();
    source.update(b"nac-orchestrator-compaction-source-v1\0");
    source.update((boundary as u64).to_be_bytes());
    update_bytes(&mut source, &serde_json::to_vec(&old_messages[1]).unwrap());
    let old_source: [u8; 32] = source.finalize().into();
    let mut policy = Sha256::new();
    policy.update(b"nac-direct-compaction-system-policy-v1\0");
    policy.update(1_u32.to_be_bytes());
    update_bytes(
        &mut policy,
        include_str!("../../../store/schema/fixtures/v54-direct-compaction.md").as_bytes(),
    );
    update_bytes(&mut policy, HISTORICAL_CONTEXT_PREFIX.as_bytes());
    update_bytes(&mut policy, &serde_json::to_vec(&old_messages[0]).unwrap());
    let old_policy: [u8; 32] = policy.finalize().into();
    conn.execute("INSERT INTO orchestrator_compaction_checkpoints(id,session_id,summary,tail_start_message_index,source_prefix_sha256,system_policy_sha256,prompt_policy_version,old_context_estimate,new_context_estimate,created_at) VALUES(1,'child',?1,2,?2,?3,1,100,50,'now')",rusqlite::params![installed_summary("verified"),old_source.as_slice(),old_policy.as_slice()]).unwrap();
    conn.execute("INSERT INTO orchestrator_compaction_checkpoints(id,session_id,previous_checkpoint_id,summary,tail_start_message_index,source_prefix_sha256,system_policy_sha256,prompt_policy_version,old_context_estimate,new_context_estimate,created_at) VALUES(2,'child',1,?1,3,zeroblob(32),zeroblob(32),1,100,50,'now')",[installed_summary("stale newest")]).unwrap();
    drop(conn);
    store::initialize(&path).unwrap();
    store::initialize(&path).unwrap();
    let conn = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        conn.query_row::<String, _, _>(
            "SELECT messages_json FROM sessions WHERE session_id='child'",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        json
    );
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT prompt_policy_version FROM session_compaction_checkpoints WHERE id=2",
            [],
            |row| row.get(0)
        )
        .unwrap(),
        1
    );
    drop(conn);
    let mut resumed = old_messages.clone();
    resumed[0] = Message::System {
        content: format!(
            "{}{}",
            crate::agent::render_general_child_system_prompt("/tmp/project", description),
            suffix
        ),
    };
    let mut restored = CompactionState::new(path.clone(), "child".into(), None);
    restored.restore_newest_valid_checkpoint(&resumed).unwrap();
    assert_eq!(restored.active_checkpoint_for_test().unwrap().id, 1);
    resumed[0] = Message::System {
        content: format!(
            "{}\n\nChanged project instructions.",
            crate::agent::render_general_child_system_prompt("/tmp/project", description)
        ),
    };
    restored.restore_newest_valid_checkpoint(&resumed).unwrap();
    assert!(restored.active_checkpoint_for_test().is_none());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
