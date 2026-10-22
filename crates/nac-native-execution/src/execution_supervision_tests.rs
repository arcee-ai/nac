use super::*;
use std::time::Duration;

#[tokio::test]
async fn codec_exchange_preserves_boot_and_nonce_without_physical_qualification() {
    for protocol in [PROTOCOL, EXECUTION_PROTOCOL] {
        let (mut a, mut b) = UnixStream::pair().unwrap();
        let a_id = Uuid::new_v4();
        let b_id = Uuid::new_v4();
        let (seen_b, seen_a) = tokio::join!(
            handshake::exchange(&mut a, a_id, true, protocol),
            handshake::exchange(&mut b, b_id, false, protocol)
        );
        assert_eq!(seen_b.unwrap(), b_id);
        assert_eq!(seen_a.unwrap(), a_id);
    }
}

#[tokio::test]
async fn closed_frames_refuse_unknown_duplicate_zero_and_oversized_inputs() {
    let id = Uuid::new_v4();
    for raw in [
        format!("{{\"kind\":\"Hello\",\"protocol\":\"{PROTOCOL}\",\"boot_id\":\"{id}\",\"challenge_id\":\"{id}\",\"extra\":true}}"),
        format!("{{\"kind\":\"Hello\",\"protocol\":\"{PROTOCOL}\",\"boot_id\":\"{id}\",\"boot_id\":\"{id}\",\"challenge_id\":\"{id}\"}}"),
    ] {
        assert!(serde_json::from_str::<Frame>(&raw).is_err());
    }
    for size in [0, MAX_FRAME + 1] {
        let (mut receiver, mut sender) = UnixStream::pair().unwrap();
        sender.write_u32(size as u32).await.unwrap();
        assert!(read_frame(&mut receiver).await.is_err());
    }
}

#[tokio::test]
async fn same_uid_or_unsupported_platform_cannot_capture_a_peer() {
    let (stream, _peer) = UnixStream::pair().unwrap();
    // SAFETY: these calls only observe the test process identity.
    let expected = ExecutionPeerExpectation {
        uid: unsafe { libc::geteuid() },
        gid: unsafe { libc::getegid() },
    };
    assert!(ExecutionSupervisionChannel::capture(
        stream,
        expected,
        Instant::now() + Duration::from_secs(1)
    )
    .is_err());
}

#[cfg(target_os = "linux")]
mod actual_kernel {
    use super::*;

    // Actual kernel resources, with no fake inward owner. Same-UID test pairs
    // bypass only this private adapter's constructor, never its public policy
    // or Core's separate private qualification. Other hosts test the pure codec.
    fn genuine_pair() -> (ExecutionSupervisionChannel, ExecutionSupervisionChannel) {
        let (a, b) = UnixStream::pair().unwrap();
        let cutoff = Instant::now() + Duration::from_secs(1);
        let channel = |stream| {
            let (stream, peer) = peer_channel::capture(stream, cutoff.into_std()).unwrap();
            ExecutionSupervisionChannel {
                stream,
                peer,
                denied: AtomicBool::new(false),
                negotiated: false,
                protocol: None,
            }
        };
        (channel(a), channel(b))
    }

    async fn exchange(a: &mut ExecutionSupervisionChannel, b: &mut ExecutionSupervisionChannel) {
        let a_id = Uuid::new_v4();
        let b_id = Uuid::new_v4();
        let (seen_b, seen_a) = tokio::join!(a.negotiate(a_id, true), b.negotiate(b_id, false));
        assert_eq!(seen_b.unwrap(), b_id);
        assert_eq!(seen_a.unwrap(), a_id);
    }

    #[tokio::test]
    async fn cancelled_negotiation_denies_actual_inward_owner_without_retry() {
        let (mut original, _silent_peer) = genuine_pair();
        assert!(tokio::time::timeout(
            Duration::from_millis(10),
            original.negotiate(Uuid::new_v4(), true)
        )
        .await
        .is_err());
        assert!(original.peer.check_current().is_err());
        assert!(original.check_current().is_err());
        assert!(original.negotiate(Uuid::new_v4(), true).await.is_err());
        assert!(original.into_peer_parts().is_err());
    }

    #[tokio::test]
    async fn nonce_version_exchange_is_once_only_and_does_not_create_authority() {
        let (mut a, mut b) = genuine_pair();
        exchange(&mut a, &mut b).await;
        assert!(a.negotiate(Uuid::new_v4(), true).await.is_err());
        assert!(a.peer.check_current().is_err());
        assert!(a.check_current().is_err());
    }

    #[tokio::test]
    async fn raw_mismatch_and_eof_deny_without_retry() {
        for malformed in [
            b"{}".as_slice(),
            b"{\"kind\":\"Welcome\",\"protocol\":\"other\"}".as_slice(),
        ] {
            let (mut original, mut peer) = genuine_pair();
            let write = async {
                peer.stream.write_u32(malformed.len() as u32).await.unwrap();
                peer.stream.write_all(malformed).await.unwrap();
            };
            let (result, ()) = tokio::join!(original.negotiate(Uuid::new_v4(), true), write);
            assert!(result.is_err());
            assert!(original.peer.check_current().is_err());
        }
        let (mut original, peer) = genuine_pair();
        drop(peer);
        assert!(original.negotiate(Uuid::new_v4(), true).await.is_err());
        assert!(original.check_current().is_err());
    }

    #[tokio::test]
    async fn actual_original_expiry_and_nil_boot_poison_are_sticky() {
        let (mut original, _peer) = genuine_pair();
        let cutoff = original.peer.original_cutoff();
        std::thread::sleep(
            cutoff.saturating_duration_since(std::time::Instant::now()) + Duration::from_millis(20),
        );
        assert!(original.check_current().is_err());
        assert_eq!(original.peer.original_cutoff(), cutoff);
        assert!(original.negotiate(Uuid::new_v4(), true).await.is_err());
        let (mut original, _peer) = genuine_pair();
        assert!(original.negotiate(Uuid::nil(), true).await.is_err());
        assert!(original.peer.check_current().is_err());
    }

    #[tokio::test]
    async fn a_job_frame_during_negotiation_denies_without_dispatch() {
        let (mut original, mut peer) = genuine_pair();
        let write = async {
            write_frame(
                &mut peer.stream,
                &Frame::StartPipe {
                    job_id: Uuid::new_v4(),
                    command: protocol::Command {
                        program: b"/bin/false".to_vec(),
                        args: Vec::new(),
                        cwd: b"/".to_vec(),
                        environment: Vec::new(),
                    },
                },
            )
            .await
            .unwrap();
        };
        let (result, ()) = tokio::join!(original.negotiate(Uuid::new_v4(), true), write);
        assert!(result.is_err());
        assert!(original.peer.check_current().is_err());
    }

    #[tokio::test]
    async fn v2_command_frame_cannot_be_used_as_a_v1_negotiation() {
        let (mut original, mut peer) = genuine_pair();
        let write = async {
            job_wire::write(
                &mut peer.stream,
                job_wire::Direction::ToRunner,
                &job_wire::Frame::BeginCommand {
                    job_id: Uuid::new_v4(),
                    operation: job_wire::Operation::Execute {},
                    encoded_bytes: 16,
                },
            )
            .await
            .unwrap();
        };
        let (result, ()) = tokio::join!(original.negotiate(Uuid::new_v4(), true), write);
        assert!(result.is_err());
        assert!(original.peer.check_current().is_err());
        assert!(original.into_peer_parts().is_err());
    }

    #[tokio::test]
    async fn v1_owner_cannot_be_reinterpreted_as_v2() {
        let (mut a, mut b) = genuine_pair();
        exchange(&mut a, &mut b).await;
        assert!(a.into_execution_parts().is_err());
        assert!(b.check_current().is_err());
    }

    #[tokio::test]
    async fn actual_v2_transfer_retains_same_pair_and_cutoff_without_reconstruction() {
        let (mut a, mut b) = genuine_pair();
        let binding = a.binding();
        let cutoff = a.peer.original_cutoff();
        let a_id = Uuid::new_v4();
        let b_id = Uuid::new_v4();
        let (seen_b, seen_a) = tokio::join!(
            a.negotiate_execution(a_id, true),
            b.negotiate_execution(b_id, false)
        );
        assert_eq!(seen_b.unwrap(), b_id);
        assert_eq!(seen_a.unwrap(), a_id);
        let (mut io, owner) = a.into_execution_parts().unwrap();
        assert!(io.binding() == binding && owner.binding() == binding);
        assert_eq!(owner.original_cutoff(), cutoff);
        owner.check_current().unwrap();
        drop(owner);
        assert!(io.write_all(b"late").await.is_err());
    }

    #[tokio::test]
    async fn negotiated_v2_cannot_downgrade_or_restart_v1() {
        let (mut a, mut b) = genuine_pair();
        let (left, right) = tokio::join!(
            a.negotiate_execution(Uuid::new_v4(), true),
            b.negotiate_execution(Uuid::new_v4(), false)
        );
        assert!(left.is_ok() && right.is_ok());
        assert!(a.negotiate(Uuid::new_v4(), true).await.is_err());
        assert!(a.into_execution_parts().is_err());
        assert!(b.peer.check_current().is_err());
    }

    #[tokio::test]
    async fn v1_v2_mismatch_and_v2_cancellation_deny_actual_owner_permanently() {
        let (mut a, mut b) = genuine_pair();
        let (left, right) = tokio::join!(
            a.negotiate_execution(Uuid::new_v4(), true),
            b.negotiate(Uuid::new_v4(), false)
        );
        assert!(left.is_err() && right.is_err());
        assert!(a.peer.check_current().is_err() && b.peer.check_current().is_err());
        assert!(a.negotiate(Uuid::new_v4(), true).await.is_err());
        assert!(b.negotiate_execution(Uuid::new_v4(), false).await.is_err());

        let (mut a, _silent_peer) = genuine_pair();
        assert!(tokio::time::timeout(
            Duration::from_millis(10),
            a.negotiate_execution(Uuid::new_v4(), true)
        )
        .await
        .is_err());
        assert!(a.peer.check_current().is_err());
        assert!(a.into_execution_parts().is_err());
    }

    #[tokio::test]
    async fn matched_parts_transfer_only_after_the_original_handshake() {
        let (a, b) = genuine_pair();
        assert!(a.into_peer_parts().is_err());
        assert!(b.check_current().is_err());
        let (mut a, mut b) = genuine_pair();
        exchange(&mut a, &mut b).await;
        let original = a.binding();
        let (io, owner) = a.into_peer_parts().unwrap();
        assert!(io.binding() == original);
        assert!(io.binding() == owner.binding());
        owner.check_current().unwrap();
        drop(io);
        owner.invalidated().await;
        assert!(owner.check_current().is_err());
    }

    #[tokio::test]
    async fn retained_core_owner_drop_closes_matched_native_io() {
        let (mut a, mut b) = genuine_pair();
        exchange(&mut a, &mut b).await;
        let (mut io, owner) = a.into_peer_parts().unwrap();
        drop(owner);
        assert!(io.write_all(b"x").await.is_err());
        assert!(b.check_current().is_err());
    }
}
