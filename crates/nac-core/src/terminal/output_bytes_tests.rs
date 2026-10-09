use super::*;

#[test]
fn byte_pages_preserve_split_unicode_controls_and_invalid_bytes() {
    let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
    let artifact = registry.create(ArtifactKind::Pty).unwrap();
    let id = artifact.output_id();
    let bytes = b"\xe4\xb8\xad\xf0\x9f\x99\x82\x1b[2J\xff\x00\r\n";
    registry
        .append(id, OutputStream::Combined, bytes.to_vec())
        .unwrap();
    let mut cursor = 0;
    let mut observed = Vec::new();
    for _ in 0..bytes.len() {
        let page = registry
            .page_bytes(id, OutputStream::Combined, cursor, 1)
            .unwrap();
        assert_eq!(page.bytes.len(), 1);
        assert!(!page.gap);
        observed.extend(page.bytes);
        cursor = page.next_offset;
    }
    assert_eq!(observed, bytes);
    assert_eq!(cursor, bytes.len() as u64);
    let end = registry
        .page_bytes(id, OutputStream::Combined, cursor, 1)
        .unwrap();
    assert!(end.caught_up);
    assert!(end.bytes.is_empty());
}

#[test]
fn byte_observers_have_independent_cursors_and_gap_is_not_a_tail_splice() {
    let registry = OutputRegistry::new(CommandOutputLimits {
        per_command_bytes: 8,
        per_session_bytes: 16,
    })
    .unwrap();
    let artifact = registry.create(ArtifactKind::Pty).unwrap();
    let id = artifact.output_id();
    registry
        .append(id, OutputStream::Combined, b"01234567".to_vec())
        .unwrap();
    let fast = registry
        .page_bytes(id, OutputStream::Combined, 0, 8)
        .unwrap();
    let slow = registry
        .page_bytes(id, OutputStream::Combined, 0, 3)
        .unwrap();
    assert_eq!(fast.next_offset, 8);
    assert_eq!(slow.next_offset, 3);
    registry
        .append(id, OutputStream::Combined, b"89abcdef".to_vec())
        .unwrap();
    let fast = registry
        .page_bytes(id, OutputStream::Combined, fast.next_offset, 8)
        .unwrap();
    assert_eq!(fast.bytes, b"89abcdef");
    assert!(!fast.gap);
    let gap = registry
        .page_bytes(id, OutputStream::Combined, slow.next_offset, 8)
        .unwrap();
    assert!(gap.gap);
    assert!(gap.bytes.is_empty());
    assert_eq!(gap.retained_start, 8);
    assert_eq!(gap.next_offset, gap.retained_start);
    assert!(!gap.caught_up);
    let reset = registry
        .page_bytes(id, OutputStream::Combined, gap.retained_start, 8)
        .unwrap();
    assert_eq!(reset.bytes, b"89abcdef");
    assert!(!reset.gap);
}

#[test]
fn byte_pages_validate_bounds_stream_and_live_end_cursor() {
    let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
    let artifact = registry.create(ArtifactKind::Pty).unwrap();
    let id = artifact.output_id();
    assert!(registry
        .page_bytes(id, OutputStream::Combined, 0, 0)
        .is_err());
    assert!(registry
        .page_bytes(id, OutputStream::Combined, 0, MAX_OUTPUT_PAGE_BYTES + 1)
        .is_err());
    assert!(registry.page_bytes(id, OutputStream::Stdout, 0, 1).is_err());
    assert!(registry
        .page_bytes(id, OutputStream::Combined, 1, 1)
        .is_err());
    let page = registry
        .page_bytes(id, OutputStream::Combined, 0, 1)
        .unwrap();
    assert!(page.caught_up);
    registry
        .append(id, OutputStream::Combined, b"later".to_vec())
        .unwrap();
    assert_eq!(
        registry
            .page_bytes(id, OutputStream::Combined, page.next_offset, 5)
            .unwrap()
            .bytes,
        b"later"
    );
}

#[test]
fn sanitized_collection_yields_identical_live_and_replay_bytes() {
    let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
    let artifact = registry.create(ArtifactKind::Pty).unwrap();
    let id = artifact.output_id();
    let snapshot = nac_contracts::CommandEnvironmentSnapshot::from_parts(
        Default::default(),
        vec!["synthetic-token".into()],
    );
    let mut redactor = snapshot.stream_redactor();
    let mut live = Vec::new();
    let mut cursor = 0;
    for chunk in [
        b"\x1b[Hsynthetic-".as_slice(),
        b"tok".as_slice(),
        b"en\r\nvisible".as_slice(),
    ] {
        registry
            .append(id, OutputStream::Combined, redactor.push(chunk))
            .unwrap();
        let page = registry
            .page_bytes(id, OutputStream::Combined, cursor, MAX_OUTPUT_PAGE_BYTES)
            .unwrap();
        cursor = page.next_offset;
        live.extend(page.bytes);
    }
    registry
        .append(id, OutputStream::Combined, redactor.finish())
        .unwrap();
    let replay = registry
        .page_bytes(id, OutputStream::Combined, 0, MAX_OUTPUT_PAGE_BYTES)
        .unwrap();
    assert_eq!(live, b"\x1b[H[REDACTED]\r\nvisible");
    assert_eq!(replay.bytes, live);
}
