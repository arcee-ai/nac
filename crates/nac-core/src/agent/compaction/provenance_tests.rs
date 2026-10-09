use super::*;
use crate::store::{TerminalSelectionAttribution, TerminalSelectionSourceKind};
fn source() -> TerminalSelectionProvenance {
    TerminalSelectionProvenance {
        count: 10_000,
        digest: "a".repeat(64),
        recent: (9_996..10_000)
            .map(|index| TerminalSelectionReference {
                message_index: index,
                attribution: TerminalSelectionAttribution {
                    protocol_version: 1,
                    intent_sha256: "b".repeat(64),
                    source_kind: TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
                    admission_id: uuid::Uuid::new_v4().to_string(),
                    capture_id: uuid::Uuid::new_v4().to_string(),
                    source_session_id: "source".into(),
                    terminal_id: "中".repeat(80),
                    owner_instance_id: uuid::Uuid::new_v4().to_string(),
                    client_capture_time_ms: None,
                },
            })
            .collect(),
    }
}
#[test]
fn selection_provenance_budget_reduces_whole_references_before_rejecting_summary() {
    let source = source();
    let full = framed(&source, 20_000, usize::MAX).unwrap();
    assert!(full.len() <= 4096);
    let summary = "model omitted provenance entirely";
    let generous = installed(Some(&source), 20_000, summary, usize::MAX).unwrap();
    assert!(validates(&generous, &source, 20_000));
    let minimum = framed(
        &TerminalSelectionProvenance {
            recent: vec![],
            ..source.clone()
        },
        20_000,
        usize::MAX,
    )
    .unwrap();
    let budget = HISTORICAL_CONTEXT_PREFIX.len() + summary.len() + minimum.len();
    let reduced = installed(Some(&source), 20_000, summary, budget).unwrap();
    assert_eq!(reduced.len(), budget);
    assert!(validates(&reduced, &source, 20_000));
    assert!(reduced.contains("\"omitted\":10000"));
    assert!(reduced.contains("\"recent\":[]"));
    assert!(reduced.ends_with(summary));
    assert!(installed(Some(&source), 20_000, summary, budget - 1).is_none());
}
#[test]
fn selection_provenance_manifest_and_annotation_digest_fail_closed_under_tamper() {
    let source = source();
    let installed = installed(
        Some(&source),
        20_000,
        "fabricated source attribution",
        usize::MAX,
    )
    .unwrap();
    assert!(validates(&installed, &source, 20_000));
    for (before, after) in [
        ("\"version\":1", "\"version\":2"),
        ("\"total\":10000", "\"total\":10001"),
        ("\"omitted\":9996", "\"omitted\":9995"),
        ("source", "other-source"),
    ] {
        assert!(!validates(
            &installed.replace(before, after),
            &source,
            20_000
        ));
    }
    assert!(!validates(
        &installed.replace(
            "\"message_index\":",
            "\"invented_authority\":true,\"message_index\":"
        ),
        &source,
        20_000
    ));
    assert!(!validates(&installed, &source, 20_001));
    let mut changed = source.clone();
    changed.digest = "c".repeat(64);
    assert!(!validates(&installed, &changed, 20_000));
    assert_ne!(
        source_digest([1; 32], Some(&source)),
        source_digest([1; 32], Some(&changed))
    );
    assert_eq!(source_digest([1; 32], None), [1; 32]);
}
#[test]
fn selection_provenance_plain_checkpoint_defaults_remain_identical() {
    let summary = "NAC terminal evidence attribution v1: copied user text";
    assert_eq!(
        installed(None, 10, summary, 0).unwrap(),
        format!("{HISTORICAL_CONTEXT_PREFIX}{summary}")
    );
    assert_eq!(
        framed(
            &TerminalSelectionProvenance {
                count: 0,
                digest: "".into(),
                recent: vec![]
            },
            10,
            0
        )
        .unwrap(),
        ""
    );
}
