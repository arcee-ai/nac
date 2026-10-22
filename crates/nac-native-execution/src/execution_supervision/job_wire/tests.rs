use super::super::protocol::{Command, EnvironmentEntry};
use super::assembly::{Assembly, AssemblyId};
use super::command::{decode_command, encode_command};
use super::*;

fn command() -> Command {
    Command {
        program: b"/p".to_vec(),
        cwd: b"/".to_vec(),
        args: vec![vec![0xff, b' '], Vec::new()],
        environment: vec![EnvironmentEntry {
            name: b"X".to_vec(),
            value: vec![0xfe],
        }],
    }
}

fn maximum_command() -> Command {
    let mut command = command();
    command.args = vec![Vec::new(); MAX_ARGUMENTS];
    command.environment = (0..MAX_ENVIRONMENT)
        .map(|n| EnvironmentEntry {
            name: format!("N{n}").into_bytes(),
            value: Vec::new(),
        })
        .collect();
    let used = command.program.len()
        + command.cwd.len()
        + command
            .environment
            .iter()
            .map(|e| e.name.len())
            .sum::<usize>();
    command.args[0] = vec![255; MAX_COMMAND_BYTES - used];
    command
}

#[tokio::test]
async fn maximum_command_and_counts_fit_real_four_kib_frames_without_lowering_limits() {
    let command = maximum_command();
    let encoded = encode_command(&command).unwrap();
    assert_eq!(encoded.len(), MAX_ENCODED_COMMAND);
    assert_eq!(MAX_ENCODED_COMMAND, 286736);
    // The original single JSON command cannot fit the handshake frame budget.
    assert!(serde_json::to_vec(&command).unwrap().len() > MAX_FRAME);
    let job_id = Uuid::new_v4();
    let id = AssemblyId::Command(job_id);
    let mut assembled = Assembly::new(id, encoded.len()).unwrap();
    let (mut sender, mut receiver) = tokio::io::duplex(MAX_FRAME * 2);
    for (index, data) in encoded.chunks(MAX_FRAGMENT).enumerate() {
        let frame = Frame::CommandFragment {
            job_id,
            offset: (index * MAX_FRAGMENT) as u32,
            data: data.to_vec(),
        };
        write(&mut sender, Direction::ToRunner, &frame)
            .await
            .unwrap();
        match read(&mut receiver, Direction::ToRunner).await.unwrap() {
            Frame::CommandFragment {
                job_id: seen,
                offset,
                data,
            } => {
                assert_eq!(seen, job_id);
                assembled.push(id, offset as usize, &data).unwrap();
            }
            _ => panic!("closed command fragment expected"),
        }
    }
    let decoded = decode_command(&assembled.finish(id).unwrap()).unwrap();
    assert_eq!(decoded.program, command.program);
    assert_eq!(decoded.cwd, command.cwd);
    assert_eq!(decoded.args, command.args);
    assert_eq!(decoded.environment.len(), MAX_ENVIRONMENT);
    for (actual, expected) in decoded.environment.iter().zip(&command.environment) {
        assert_eq!(actual.name, expected.name);
        assert_eq!(actual.value, expected.value);
    }
}

#[test]
fn every_record_has_bounded_serialized_metadata_at_maximum_fields() {
    let job_id = Uuid::from_u128(u128::MAX);
    let data = vec![255; MAX_FRAGMENT];
    let mut records = vec![
        (
            Direction::ToRunner,
            Frame::BeginCommand {
                job_id,
                operation: Operation::Execute {},
                encoded_bytes: MAX_ENCODED_COMMAND as u32,
            },
        ),
        (
            Direction::ToRunner,
            Frame::BeginCommand {
                job_id,
                operation: Operation::Pipe {},
                encoded_bytes: MAX_ENCODED_COMMAND as u32,
            },
        ),
        (
            Direction::ToRunner,
            Frame::BeginCommand {
                job_id,
                operation: Operation::Pty {
                    rows: u16::MAX,
                    cols: u16::MAX,
                },
                encoded_bytes: MAX_ENCODED_COMMAND as u32,
            },
        ),
        (
            Direction::ToRunner,
            Frame::BeginCommand {
                job_id,
                operation: Operation::FileChild {},
                encoded_bytes: MAX_ENCODED_COMMAND as u32,
            },
        ),
        (
            Direction::ToRunner,
            Frame::CommandFragment {
                job_id,
                offset: (MAX_ENCODED_COMMAND - MAX_FRAGMENT) as u32,
                data: data.clone(),
            },
        ),
        (Direction::ToRunner, Frame::CommitCommand { job_id }),
        (Direction::ToRunner, Frame::StdinEof { job_id }),
        (
            Direction::ToRunner,
            Frame::Resize {
                job_id,
                control_id: u64::MAX,
                rows: u16::MAX,
                cols: u16::MAX,
            },
        ),
        (Direction::ToRunner, Frame::Terminate { job_id }),
        (Direction::ToClient, Frame::Started { job_id }),
        (Direction::ToClient, Frame::InputClosed { job_id }),
        (
            Direction::ToClient,
            Frame::Exited {
                job_id,
                code: Some(255),
                signal: None,
            },
        ),
        (
            Direction::ToClient,
            Frame::Exited {
                job_id,
                code: None,
                signal: Some(64),
            },
        ),
        (Direction::ToClient, Frame::Reaped { job_id }),
        (
            Direction::ToClient,
            Frame::Resized {
                job_id,
                control_id: u64::MAX,
            },
        ),
        (Direction::ToRunner, Frame::Released { job_id }),
        (Direction::ToRunner, Frame::Close {}),
        (Direction::ToClient, Frame::Closed {}),
    ];
    for stream in [
        Stream::Stdin,
        Stream::Stdout,
        Stream::Stderr,
        Stream::PtyOutput,
    ] {
        let direction = stream.direction();
        records.extend([
            (
                direction.opposite(),
                Frame::Credit {
                    job_id,
                    stream,
                    upto: u64::MAX,
                },
            ),
            (
                direction,
                Frame::BeginData {
                    job_id,
                    stream,
                    block: u64::MAX,
                    bytes: MAX_DATA as u32,
                },
            ),
            (
                direction,
                Frame::DataFragment {
                    job_id,
                    stream,
                    block: u64::MAX,
                    offset: (MAX_DATA - MAX_FRAGMENT) as u32,
                    data: data.clone(),
                },
            ),
            (
                direction,
                Frame::EndData {
                    job_id,
                    stream,
                    block: u64::MAX,
                },
            ),
        ]);
    }
    for (direction, frame) in records {
        frame.validate(direction).unwrap();
        let raw = serde_json::to_vec(&frame).unwrap();
        assert!(raw.len() <= MAX_FRAME, "{} bytes", raw.len());
        let other = if direction == Direction::ToRunner {
            Direction::ToClient
        } else {
            Direction::ToRunner
        };
        assert!(frame.validate(other).is_err());
    }
}

#[test]
fn binary_decode_rejects_truncation_trailing_bytes_counts_and_invalid_commands() {
    let encoded = encode_command(&command()).unwrap();
    for end in 0..encoded.len() {
        assert!(
            decode_command(&encoded[..end]).is_err(),
            "truncated at{end}"
        );
    }
    let mut bad = encoded.clone();
    bad.push(0);
    assert!(decode_command(&bad).is_err());
    let mut bad = encoded.clone();
    bad[..4].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(decode_command(&bad).is_err());
    let mut bad = encoded.clone();
    bad[4] = 0;
    assert!(decode_command(&bad).is_err());
    let mut bad = encoded.clone();
    bad[11..15].copy_from_slice(&u32::MAX.to_be_bytes());
    assert!(decode_command(&bad).is_err());
    let mut bad = maximum_command();
    bad.args[1].push(1);
    assert!(encode_command(&bad).is_err());
    let mut bad = command();
    bad.args.resize(MAX_ARGUMENTS + 1, Vec::new());
    assert!(encode_command(&bad).is_err());
    let mut bad = command();
    bad.environment
        .extend((0..MAX_ENVIRONMENT).map(|n| EnvironmentEntry {
            name: format!("Y{n}").into_bytes(),
            value: Vec::new(),
        }));
    assert!(encode_command(&bad).is_err());
    assert!(decode_command(&vec![1; MAX_ENCODED_COMMAND + 1]).is_err());
}

#[test]
fn logical_data_preserves_full_sixteen_kib_and_assembly_errors_are_sticky() {
    let job_id = Uuid::new_v4();
    let id = AssemblyId::Data {
        job_id,
        stream: Stream::Stdout,
        block: u64::MAX,
    };
    let bytes = vec![255; MAX_DATA];
    let mut assembly = Assembly::new(id, MAX_DATA).unwrap();
    for (index, data) in bytes.chunks(MAX_FRAGMENT).enumerate() {
        assembly.push(id, index * MAX_FRAGMENT, data).unwrap();
    }
    assert_eq!(assembly.finish(id).unwrap(), bytes);
    for (other_id, offset, data) in [
        (AssemblyId::Command(job_id), 0, vec![1]),
        (
            AssemblyId::Data {
                job_id,
                stream: Stream::Stderr,
                block: u64::MAX,
            },
            0,
            vec![1],
        ),
        (
            AssemblyId::Data {
                job_id,
                stream: Stream::Stdout,
                block: 0,
            },
            0,
            vec![1],
        ),
        (
            AssemblyId::Data {
                job_id: Uuid::new_v4(),
                stream: Stream::Stdout,
                block: u64::MAX,
            },
            0,
            vec![1],
        ),
        (id, 1, vec![1]),
        (id, usize::MAX, vec![1]),
        (id, 0, Vec::new()),
        (id, 0, vec![1; MAX_FRAGMENT + 1]),
        (id, 0, vec![1; 9]),
    ] {
        let mut assembly = Assembly::new(id, 8).unwrap();
        assert!(assembly.push(other_id, offset, &data).is_err());
        assert!(assembly.push(id, 0, &[1; 8]).is_err());
        assert!(assembly.finish(id).is_err());
    }
    let mut assembly = Assembly::new(id, 2).unwrap();
    assembly.push(id, 0, &[1]).unwrap();
    assert!(assembly.push(id, 0, &[2]).is_err());
    assert!(assembly.finish(id).is_err());
    assert!(Assembly::new(id, 0).is_err());
    assert!(Assembly::new(id, MAX_DATA + 1).is_err());
    assert!(Assembly::new(AssemblyId::Command(Uuid::nil()), 1).is_err());
    assert!(Assembly::new(id, 1).unwrap().finish(id).is_err());
}

#[tokio::test]
async fn closed_decode_refuses_unknown_duplicate_truncated_wrong_role_and_oversized_frames() {
    let job_id = Uuid::new_v4();
    for raw in [
        r#"{"kind":"Open","path":"/key"}"#.to_string(),
        r#"{"kind":"Sign","payload":[]}"#.to_string(),
        r#"{"kind":"Hello","protocol":"nac-protected-execution-v1"}"#.to_string(),
        r#"{"kind":"Close","extra":true}"#.to_string(),
        r#"{"kind":"Close","kind":"Close"}"#.to_string(),
        format!(r#"{{"kind":"CommitCommand","job_id":"{job_id}","job_id":"{job_id}"}}"#),
        format!(
            r#"{{"kind":"BeginCommand","job_id":"{job_id}","operation":{{"mode":"Execute","extra":true}},"encoded_bytes":16}}"#
        ),
        format!(
            r#"{{"kind":"BeginCommand","job_id":"{job_id}","operation":{{"mode":"Execute","mode":"Execute"}},"encoded_bytes":16}}"#
        ),
        format!(
            r#"{{"kind":"BeginCommand","job_id":"{job_id}","operation":{{"mode":"Pipe","extra":true}},"encoded_bytes":16}}"#
        ),
        format!(
            r#"{{"kind":"BeginCommand","job_id":"{job_id}","operation":{{"mode":"FileChild","extra":true}},"encoded_bytes":16}}"#
        ),
        format!(
            r#"{{"kind":"BeginCommand","job_id":"{job_id}","operation":{{"mode":"Pty","rows":1,"cols":1,"extra":true}},"encoded_bytes":16}}"#
        ),
        format!(r#"{{"kind":"Resize","job_id":"{job_id}","rows":1,"cols":1}}"#),
        format!(r#"{{"kind":"Resize","job_id":"{job_id}","control_id":0,"rows":1,"cols":1}}"#),
        format!(
            r#"{{"kind":"Resize","job_id":"{job_id}","control_id":1,"control_id":2,"rows":1,"cols":1}}"#
        ),
        format!(r#"{{"kind":"Released","job_id":"{job_id}","extra":true}}"#),
        format!(r#"{{"kind":"Resized","job_id":"{job_id}","control_id":1}}"#),
        format!(r#"{{"kind":"Started","job_id":"{job_id}"}}"#),
        format!(r#"{{"kind":"Credit","job_id":"{job_id}","stream":"Stdin","upto":1}}"#),
        format!(r#"{{"kind":"Credit","job_id":"{job_id}","stream":"Stdout","upto":0}}"#),
        format!(
            r#"{{"kind":"Credit","job_id":"{job_id}","stream":"Stdout","upto":1,"extra":true}}"#
        ),
        format!(r#"{{"kind":"Credit","job_id":"{job_id}","stream":"Stdout","upto":1,"upto":2}}"#),
    ] {
        let (mut writer, mut reader) = tokio::io::duplex(MAX_FRAME * 2);
        writer.write_u32(raw.len() as u32).await.unwrap();
        writer.write_all(raw.as_bytes()).await.unwrap();
        assert!(
            read(&mut reader, Direction::ToRunner).await.is_err(),
            "{raw}"
        );
    }
    for len in [0, MAX_FRAME + 1, u32::MAX as usize] {
        let (mut writer, mut reader) = tokio::io::duplex(16);
        writer.write_u32(len as u32).await.unwrap();
        assert!(read(&mut reader, Direction::ToRunner).await.is_err());
    }
    let (mut writer, mut reader) = tokio::io::duplex(16);
    writer.write_u32(5).await.unwrap();
    writer.write_all(b"{}").await.unwrap();
    drop(writer);
    assert!(read(&mut reader, Direction::ToRunner).await.is_err());
}

#[tokio::test]
async fn credit_round_trips_only_opposite_its_data_direction() {
    let job_id = Uuid::new_v4();
    for stream in [
        Stream::Stdin,
        Stream::Stdout,
        Stream::Stderr,
        Stream::PtyOutput,
    ] {
        let direction = stream.direction().opposite();
        let (mut writer, mut reader) = tokio::io::duplex(MAX_FRAME * 2);
        write(
            &mut writer,
            direction,
            &Frame::Credit {
                job_id,
                stream,
                upto: u64::MAX,
            },
        )
        .await
        .unwrap();
        match read(&mut reader, direction).await.unwrap() {
            Frame::Credit {
                job_id: seen,
                stream: seen_stream,
                upto,
            } => {
                assert_eq!(seen, job_id);
                assert_eq!(seen_stream, stream);
                assert_eq!(upto, u64::MAX);
            }
            _ => panic!("credit expected"),
        }
    }
}

#[test]
fn frame_validation_refuses_overflow_empty_chunks_limits_and_missing_identity() {
    let job_id = Uuid::new_v4();
    for frame in [
        Frame::BeginCommand {
            job_id,
            operation: Operation::Execute {},
            encoded_bytes: MAX_ENCODED_COMMAND as u32 + 1,
        },
        Frame::BeginCommand {
            job_id,
            operation: Operation::Pty { rows: 0, cols: 1 },
            encoded_bytes: 16,
        },
        Frame::CommandFragment {
            job_id,
            offset: u32::MAX,
            data: vec![1],
        },
        Frame::CommandFragment {
            job_id,
            offset: 0,
            data: vec![1; MAX_FRAGMENT + 1],
        },
        Frame::CommandFragment {
            job_id,
            offset: 0,
            data: Vec::new(),
        },
        Frame::BeginData {
            job_id,
            stream: Stream::Stdin,
            block: 0,
            bytes: MAX_DATA as u32 + 1,
        },
        Frame::DataFragment {
            job_id,
            stream: Stream::Stdin,
            block: 0,
            offset: MAX_DATA as u32,
            data: vec![1],
        },
        Frame::Terminate {
            job_id: Uuid::nil(),
        },
        Frame::Resize {
            job_id,
            control_id: 1,
            rows: 1,
            cols: 0,
        },
    ] {
        assert!(frame.validate(Direction::ToRunner).is_err());
    }
    for (code, signal) in [
        (Some(256), None),
        (Some(-1), None),
        (None, Some(0)),
        (None, Some(65)),
        (Some(0), Some(9)),
    ] {
        assert!(Frame::Exited {
            job_id,
            code,
            signal
        }
        .validate(Direction::ToClient)
        .is_err());
    }
}
