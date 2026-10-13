use super::*;
use crate::terminal::{ArtifactKind, CommandOutputLimits};
use std::collections::BTreeMap;

struct SplitReader {
    chunks: std::collections::VecDeque<io::Result<Vec<u8>>>,
}

impl Read for SplitReader {
    fn read(&mut self, destination: &mut [u8]) -> io::Result<usize> {
        let chunk = self.chunks.pop_front().unwrap_or_else(|| Ok(Vec::new()))?;
        destination[..chunk.len()].copy_from_slice(&chunk);
        Ok(chunk.len())
    }
}

fn collect(
    chunks: Vec<io::Result<Vec<u8>>>,
) -> (
    OutputRegistry,
    super::super::OutputArtifactLease,
    CollectorState,
) {
    let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
    let lease = registry.create(ArtifactKind::Pty).unwrap();
    let environment = nac_contracts::CommandEnvironmentSnapshot::from_parts(
        BTreeMap::new(),
        vec!["secret".into(), "cret-value".into()],
    );
    let state = CollectorState::default();
    PtyCollector {
        registry: registry.clone(),
        output_id: lease.output_id().to_owned(),
        redactor: Some(environment.stream_redactor()),
        alive: Arc::new(AtomicBool::new(true)),
        notify: Arc::new(Notify::new()),
        state: state.clone(),
    }
    .collect(SplitReader {
        chunks: chunks.into(),
    });
    (registry, lease, state)
}

#[test]
fn collection_masks_before_live_or_replay_and_preserves_other_bytes() {
    let bytes = b"\x1b[31msecret-value\x1b[0m\xff\r\nsec";
    for split in 0..=bytes.len() {
        // Empty reads mean EOF; omit empty fixture partitions.
        let chunks = [&bytes[..split], &bytes[split..]]
            .into_iter()
            .filter(|bytes| !bytes.is_empty())
            .map(|bytes| Ok(bytes.to_vec()))
            .collect();
        let (registry, lease, state) = collect(chunks);
        let page = registry
            .page_bytes(lease.output_id(), OutputStream::Combined, 0, 1024)
            .unwrap();
        assert_eq!(page.bytes, b"\x1b[31m[REDACTED]\x1b[0m\xff\r\nsec");
        assert!(state.complete());
        assert!(state.error().is_none());
    }
}

#[test]
fn failed_read_does_not_flush_a_possible_secret_prefix() {
    let (registry, lease, state) = collect(vec![
        Ok(b"safe sec".to_vec()),
        Err(io::ErrorKind::Other.into()),
    ]);
    assert_eq!(
        registry
            .page_bytes(lease.output_id(), OutputStream::Combined, 0, 1024)
            .unwrap()
            .bytes,
        b"safe "
    );
    assert!(state.complete());
    assert_eq!(state.error(), Some("terminal output read failed"));
}

#[test]
fn interrupted_read_continues_without_flush_or_lost_match() {
    let (registry, lease, state) = collect(vec![
        Ok(b"sec".to_vec()),
        Err(io::ErrorKind::Interrupted.into()),
        Ok(b"ret".to_vec()),
    ]);
    assert_eq!(
        registry
            .page_bytes(lease.output_id(), OutputStream::Combined, 0, 1024)
            .unwrap()
            .bytes,
        b"[REDACTED]"
    );
    assert!(state.error().is_none());
}

#[test]
fn retention_failure_is_observable_without_publishing_pending_bytes() {
    let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
    let lease = registry.create(ArtifactKind::Pty).unwrap();
    let state = CollectorState::default();
    registry.clear();
    PtyCollector {
        registry,
        output_id: lease.output_id().to_owned(),
        redactor: None,
        alive: Arc::new(AtomicBool::new(true)),
        notify: Arc::new(Notify::new()),
        state: state.clone(),
    }
    .collect(&b"output"[..]);
    assert!(state.complete());
    assert_eq!(state.error(), Some("terminal output retention failed"));
}
