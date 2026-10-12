use super::*;
#[test]
fn selection_provenance_context_samples_bind_typed_source_and_reset_with_transcript() {
    let mut state = CompactionState::new(
        PathBuf::from("unused.db"),
        "session".into(),
        None,
        CompactionPolicy::Direct,
    );
    let messages = vec![Message::User {
        content: "copied selection framing remains literal".into(),
    }];
    let source = crate::store::TerminalSelectionProvenance {
        count: 1,
        digest: "a".repeat(64),
        recent: vec![],
    };
    state.selection_sources.insert(1, source.clone());
    state.record_ordinary_context(&messages, 12_000, 1, None);
    assert_eq!(state.prepare(&messages, &[]).context_estimate, 12_000);
    state.selection_sources.get_mut(&1).unwrap().digest = "b".repeat(64);
    assert!(state.prepare(&messages, &[]).context_estimate < 12_000);
    assert!(state.context_sample.is_none());
    state.selection_sources.insert(1, source);
    state.record_ordinary_context(&messages, 12_000, 1, None);
    state.reset_for_transcript_replacement();
    assert!(state.selection_sources.is_empty());
    assert!(state.context_sample.is_none());
}

#[test]
fn selection_provenance_uncached_sample_boundary_is_unknown() {
    let mut state = CompactionState::new(
        PathBuf::from("unused.db"),
        "session".into(),
        None,
        CompactionPolicy::Direct,
    );
    state.selection_sources.insert(
        1,
        crate::store::TerminalSelectionProvenance {
            count: 1,
            digest: "a".repeat(64),
            recent: vec![],
        },
    );
    let messages = vec![
        Message::User {
            content: "literal evidence".into(),
        },
        Message::User {
            content: "new evidence may have attribution".into(),
        },
    ];
    state.record_ordinary_context(&messages, 12_000, 2, None);
    assert!(state.context_sample.is_none());
    assert!(state.selection_sample_digest(2).is_none());
}
