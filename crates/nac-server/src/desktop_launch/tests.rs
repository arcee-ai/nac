use super::*;

#[test]
fn records_are_bounded_and_require_a_complete_line() {
    for bytes in [
        vec![b'x'; LIMIT + 1],
        b"{\"kind\":\"hello\"}".to_vec(),
        vec![],
    ] {
        assert!(read_record(&mut std::io::Cursor::new(bytes)).is_err());
    }
    let mut reader = std::io::Cursor::new(b"one\ntwo\n");
    assert_eq!(read_record(&mut reader).unwrap(), b"one\n");
    assert_eq!(read_record(&mut reader).unwrap(), b"two\n");
    let mut boundary = vec![b'x'; LIMIT - 1];
    boundary.push(b'\n');
    assert_eq!(
        read_record(&mut std::io::Cursor::new(boundary))
            .unwrap()
            .len(),
        LIMIT
    );
}

#[test]
fn control_cannot_name_a_pid_or_store() {
    assert!(serde_json::from_str::<Stop>(
        r#"{"kind":"stop","version":1,"incarnation":"x","pid":123}"#
    )
    .is_err());
    assert!(serde_json::from_str::<Stop>(
        r#"{"kind":"stop","version":1,"incarnation":"x","store":"/other"}"#
    )
    .is_err());
    assert_eq!(
        Identity::current().source_revision,
        build_identity::current().source_revision
    );
}
