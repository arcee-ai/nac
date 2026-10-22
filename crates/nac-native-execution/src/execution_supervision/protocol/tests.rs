use super::*;

fn command() -> Command {
    Command {
        program: b"/bin/sh".to_vec(),
        args: vec![b"-c".to_vec(), vec![0xff, b' ']],
        cwd: vec![b'/', 0xfe],
        environment: vec![EnvironmentEntry {
            name: b"PATH".to_vec(),
            value: b"/bin".to_vec(),
        }],
    }
}

#[test]
fn command_roundtrip_preserves_non_utf8_and_empty_environment() {
    let mut original = command();
    original.environment.clear();
    let raw = serde_json::to_vec(&original).unwrap();
    let decoded: Command = serde_json::from_slice(&raw).unwrap();
    decoded.validate().unwrap();
    assert_eq!(decoded.args, original.args);
    assert_eq!(decoded.cwd, original.cwd);
    assert!(decoded.environment.is_empty());
}

#[test]
fn command_refuses_duplicate_environment_nul_and_unbounded_payloads() {
    let mut value = command();
    value.environment.push(EnvironmentEntry {
        name: b"PATH".to_vec(),
        value: b"other".to_vec(),
    });
    assert!(value.validate().is_err());
    let mut value = command();
    value.args.push(vec![0]);
    assert!(value.validate().is_err());
    let mut value = command();
    value.args.push(vec![b'x'; MAX_COMMAND_BYTES]);
    assert!(value.validate().is_err());
    for name in [b"".as_slice(), b"X=Y"] {
        let mut value = command();
        value.environment[0].name = name.to_vec();
        assert!(value.validate().is_err());
    }
    let mut value = command();
    value.cwd = b"relative".to_vec();
    assert!(value.validate().is_err());
}

#[test]
fn closed_job_frames_reject_unknown_duplicate_and_credential_operations() {
    for raw in [
        r#"{"kind":"Close","extra":true}"#.to_string(),
        r#"{"kind":"Open","path":"/trusted/key"}"#.to_string(),
        r#"{"kind":"Sign","payload":[]}"#.to_string(),
        format!(
            r#"{{"kind":"StdinEof","job_id":"{}","job_id":"{}"}}"#,
            Uuid::new_v4(),
            Uuid::new_v4()
        ),
    ] {
        assert!(serde_json::from_str::<Frame>(&raw).is_err(), "{raw}");
    }
}

#[test]
fn job_controls_require_identity_valid_dimensions_and_bounded_bytes() {
    assert!(Frame::Terminate {
        job_id: Uuid::nil()
    }
    .validate()
    .is_err());
    assert!(Frame::Resize {
        job_id: Uuid::new_v4(),
        rows: 0,
        cols: 80
    }
    .validate()
    .is_err());
    assert!(Frame::Stdin {
        job_id: Uuid::new_v4(),
        data: vec![1; MAX_DATA + 1]
    }
    .validate()
    .is_err());
    assert!(Frame::Exited {
        job_id: Uuid::new_v4(),
        code: Some(0),
        signal: Some(9)
    }
    .validate()
    .is_err());
    Frame::StartPipe {
        job_id: Uuid::new_v4(),
        command: command(),
    }
    .validate()
    .unwrap();
}
