use super::super::{job_wire::Stream, NegotiatedProtocol};
use super::*;
use nac_process::peer_channel::{self, PeerConnection};
use std::{
    future::Future,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    task::{Wake, Waker},
    time::Duration,
};
use tokio::{io::AsyncWriteExt, net::UnixStream};
use uuid::Uuid;

fn channel(stream: UnixStream) -> ExecutionSupervisionChannel {
    let (stream, peer) =
        peer_channel::capture(stream, Instant::now() + Duration::from_secs(3)).unwrap();
    // Actual kernel pair; this private same-UID fixture bypasses only the public
    // construction UID policy, never negotiation or any qualification factory.
    ExecutionSupervisionChannel {
        stream,
        peer,
        denied: AtomicBool::new(false),
        negotiated: false,
        protocol: None,
    }
}

async fn negotiated() -> (ExecutionSupervisionChannel, ExecutionSupervisionChannel) {
    let (a, b) = UnixStream::pair().unwrap();
    let (mut a, mut b) = (channel(a), channel(b));
    let (one, two) = tokio::join!(
        a.negotiate_execution(Uuid::new_v4(), true),
        b.negotiate_execution(Uuid::new_v4(), false)
    );
    one.unwrap();
    two.unwrap();
    assert!(a.protocol == Some(NegotiatedProtocol::Execution));
    (a, b)
}

async fn raw_pair() -> (NativeWire, PeerLifetime, PeerConnection, PeerLifetime) {
    let (a, b) = negotiated().await;
    let (wire, owner) = NativeWire::from_negotiated(
        a,
        Direction::ToClient,
        NonZeroUsize::new(1).unwrap(),
        crate::execution_supervision::task_set::TaskSet::unaccounted_for_test(),
    )
    .unwrap();
    let (raw, other_owner) = b.into_execution_parts().unwrap();
    (wire, owner, raw, other_owner)
}

#[tokio::test]
async fn actual_v2_pair_transfers_closed_frames_in_both_directions() {
    let (a, b) = negotiated().await;
    let (mut a, owner_a) = NativeWire::from_negotiated(
        a,
        Direction::ToClient,
        NonZeroUsize::new(1).unwrap(),
        crate::execution_supervision::task_set::TaskSet::unaccounted_for_test(),
    )
    .unwrap();
    let (mut b, _owner_b) = NativeWire::from_negotiated(
        b,
        Direction::ToRunner,
        NonZeroUsize::new(1).unwrap(),
        crate::execution_supervision::task_set::TaskSet::unaccounted_for_test(),
    )
    .unwrap();
    let id = Uuid::new_v4();
    let sender = a.sender();
    assert!(sender.binding() == owner_a.binding());
    sender
        .send(Frame::Terminate { job_id: id }, owner_a.original_cutoff())
        .await
        .unwrap();
    assert!(matches!(b.receive().await.unwrap(),Frame::Terminate{job_id} if job_id==id));
    b.sender()
        .send(Frame::Started { job_id: id }, owner_a.original_cutoff())
        .await
        .unwrap();
    assert!(matches!(a.receive().await.unwrap(),Frame::Started{job_id} if job_id==id));
}

#[tokio::test]
async fn cancelling_a_receive_mid_record_does_not_restart_the_physical_parser() {
    let (mut wire, _owner, mut raw, _other_owner) = raw_pair().await;
    let id = Uuid::new_v4();
    let encoded = job_wire::encode(Direction::ToClient, &Frame::Started { job_id: id }).unwrap();
    raw.write_u32(encoded.len() as u32).await.unwrap();
    raw.write_all(&encoded[..3]).await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(40), wire.receive())
            .await
            .is_err()
    );
    raw.write_all(&encoded[3..]).await.unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(1), wire.receive())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(frame,Frame::Started{job_id} if job_id==id));
}

#[tokio::test]
async fn full_incoming_queue_does_not_stop_the_independent_control_writer() {
    let (wire, owner, mut raw, _other_owner) = raw_pair().await;
    let id = Uuid::new_v4();
    // More records than the explicitly one-record incoming queue. Do not drain
    // it; the unrelated outgoing direction must still make progress.
    for _ in 0..3 {
        job_wire::write(
            &mut raw,
            Direction::ToClient,
            &Frame::Started { job_id: id },
        )
        .await
        .unwrap();
    }
    let sender = wire.sender();
    let (sent, received) = tokio::time::timeout(Duration::from_secs(1), async {
        tokio::join!(
            sender.send(Frame::Terminate { job_id: id }, owner.original_cutoff()),
            job_wire::read(&mut raw, Direction::ToRunner)
        )
    })
    .await
    .unwrap();
    sent.unwrap();
    assert!(matches!(received.unwrap(),Frame::Terminate{job_id} if job_id==id));
}

#[tokio::test]
async fn physical_denial_refuses_already_queued_frames_and_retained_senders() {
    let (mut wire, owner, mut raw, _other_owner) = raw_pair().await;
    let id = Uuid::new_v4();
    job_wire::write(
        &mut raw,
        Direction::ToClient,
        &Frame::Started { job_id: id },
    )
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(1), async {
        while wire.incoming.is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let sender = wire.sender();
    drop(owner);
    assert!(wire.receive().await.is_err());
    assert!(sender
        .send(
            Frame::Terminate { job_id: id },
            Instant::now() + Duration::from_secs(1)
        )
        .await
        .is_err());
}

#[tokio::test]
async fn malformed_record_denies_actual_pair_without_resynchronization() {
    let (mut wire, owner, mut raw, _other_owner) = raw_pair().await;
    let invalid = br#"{"kind":"Open","path":"/key"}"#;
    raw.write_u32(invalid.len() as u32).await.unwrap();
    raw.write_all(invalid).await.unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(1), wire.receive())
        .await
        .unwrap()
        .is_err());
    assert!(owner.check_current().is_err());
}

#[tokio::test]
async fn cancelled_queued_write_retains_unknown_outcome_as_actual_denial() {
    let (wire, owner, _connection, _other_owner) = raw_pair().await;
    // Isolate the queue/ack boundary while retaining actual physical resources.
    // No synthetic liveness callback or fabricated inward owner is used.
    let (outgoing, mut requests) = mpsc::channel(1);
    let sender = WireSender {
        peer: wire.sender.peer.clone(),
        direction: Direction::ToRunner,
        outgoing,
    };
    let mut pending = Box::pin(sender.send(
        Frame::Terminate {
            job_id: Uuid::new_v4(),
        },
        owner.original_cutoff(),
    ));
    std::future::poll_fn(|cx| {
        assert!(pending.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    let _unacknowledged = requests.recv().await.unwrap();
    drop(pending);
    assert!(owner.check_current().is_err());
}

#[tokio::test]
async fn wrong_role_and_expired_write_never_enter_the_queue() {
    for expired in [false, true] {
        let (wire, owner, _raw, _other_owner) = raw_pair().await;
        let sender = wire.sender();
        let id = Uuid::new_v4();
        let frame = if expired {
            Frame::Terminate { job_id: id }
        } else {
            Frame::Credit {
                job_id: id,
                stream: Stream::Stdin,
                upto: 1,
            }
        };
        let cutoff = if expired {
            Instant::now()
        } else {
            owner.original_cutoff()
        };
        assert!(sender.send(frame, cutoff).await.is_err());
        assert!(owner.check_current().is_err());
    }
}

#[derive(Default)]
struct WakeCount(AtomicUsize);
impl Wake for WakeCount {
    fn wake(self: Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn wake_by_ref(self: &Arc<Self>) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn a_pending_ack_wakes_on_denial_without_writer_task_progress() {
    let (wire, owner, _raw, _other_owner) = raw_pair().await;
    let (outgoing, mut requests) = mpsc::channel(1);
    let sender = WireSender {
        peer: wire.sender.peer.clone(),
        direction: Direction::ToRunner,
        outgoing,
    };
    let wakes = Arc::new(WakeCount::default());
    let waker = Waker::from(Arc::clone(&wakes));
    let mut cx = std::task::Context::from_waker(&waker);
    let mut pending = Box::pin(sender.send(
        Frame::Terminate {
            job_id: Uuid::new_v4(),
        },
        owner.original_cutoff(),
    ));
    assert!(pending.as_mut().poll(&mut cx).is_pending());
    let _unacknowledged = requests.try_recv().unwrap();
    let before = wakes.0.load(Ordering::SeqCst);
    owner.deny();
    assert!(wakes.0.load(Ordering::SeqCst) > before);
    assert!(matches!(
        pending.as_mut().poll(&mut cx),
        std::task::Poll::Ready(Err(_))
    ));
}

#[tokio::test]
async fn a_ready_ack_cannot_report_success_after_its_original_deadline() {
    let (wire, owner, _raw, _other_owner) = raw_pair().await;
    let (outgoing, mut requests) = mpsc::channel(1);
    let sender = WireSender {
        peer: wire.sender.peer.clone(),
        direction: Direction::ToRunner,
        outgoing,
    };
    let cutoff = Instant::now() + Duration::from_millis(30);
    let mut pending = Box::pin(sender.send(
        Frame::Terminate {
            job_id: Uuid::new_v4(),
        },
        cutoff,
    ));
    std::future::poll_fn(|cx| {
        assert!(pending.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    let request = requests.try_recv().unwrap();
    // Deliberately prevent this runtime's timer from being polled, then make
    // the inner ack ready too. Timeout alone may prefer its ready inner future.
    std::thread::sleep(Duration::from_millis(40));
    request.done.send(Ok(())).unwrap();
    assert!(pending.await.is_err());
    assert!(owner.check_current().is_err());
}

#[tokio::test]
async fn newly_available_queue_space_cannot_admit_a_write_after_its_deadline() {
    let (wire, owner, _raw, _other_owner) = raw_pair().await;
    let (outgoing, mut requests) = mpsc::channel(1);
    let (done, _held) = oneshot::channel();
    outgoing
        .send(Outbound {
            raw: job_wire::encode(Direction::ToRunner, &Frame::Close {}).unwrap(),
            cutoff: owner.original_cutoff(),
            done,
        })
        .await
        .unwrap();
    let sender = WireSender {
        peer: wire.sender.peer.clone(),
        direction: Direction::ToRunner,
        outgoing,
    };
    let cutoff = Instant::now() + Duration::from_millis(30);
    let mut pending = Box::pin(sender.send(
        Frame::Terminate {
            job_id: Uuid::new_v4(),
        },
        cutoff,
    ));
    std::future::poll_fn(|cx| {
        assert!(pending.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    std::thread::sleep(Duration::from_millis(40));
    let _existing = requests.try_recv().unwrap();
    assert!(pending.await.is_err());
    assert!(requests.try_recv().is_err());
    assert!(owner.check_current().is_err());
}
