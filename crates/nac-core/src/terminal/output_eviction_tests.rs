//! Session-cap eviction order and the stream-boundary scan used by eviction.

use super::*;

/// The boundary scan before its early exit, kept as an oracle.
fn full_scan_unaligned_stream_boundary(artifact: &Artifact) -> Option<usize> {
    let mut prefix_bytes = 0;
    let mut saw_stdout = false;
    let mut saw_stderr = false;
    for chunk in &artifact.chunks {
        let retained = &chunk.bytes[chunk.consumed..];
        if retained.is_empty() {
            continue;
        }
        let first_for_stream = match chunk.stream {
            OutputStream::Stdout | OutputStream::Combined if !saw_stdout => {
                saw_stdout = true;
                true
            }
            OutputStream::Stderr if !saw_stderr => {
                saw_stderr = true;
                true
            }
            _ => false,
        };
        if first_for_stream && retained[0] & 0b1100_0000 == 0b1000_0000 {
            let continuation_bytes = retained
                .iter()
                .take_while(|byte| **byte & 0b1100_0000 == 0b1000_0000)
                .count();
            return Some(prefix_bytes + continuation_bytes);
        }
        prefix_bytes += retained.len();
    }
    None
}

/// Deterministic xorshift64* generator; failures report the case seed.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }

    fn below(&mut self, bound: usize) -> usize {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) % bound as u64) as usize
    }
}

fn random_artifact(rng: &mut Rng) -> Artifact {
    let kind = if rng.below(4) == 0 {
        ArtifactKind::Pty
    } else {
        ArtifactKind::Command
    };
    // ASCII, lead bytes and continuation bytes, so many chunks start
    // mid-character after a partially consumed prefix.
    const BYTES: &[u8] = &[b'a', b'\n', 0xc3, 0xa9, 0xe4, 0xb8, 0xad, 0x80, 0xbf];
    let chunks = (0..rng.below(12))
        .map(|sequence| {
            let stream = match kind {
                ArtifactKind::Pty => OutputStream::Combined,
                ArtifactKind::Command if rng.below(2) == 0 => OutputStream::Stdout,
                ArtifactKind::Command => OutputStream::Stderr,
            };
            let bytes = (0..1 + rng.below(6))
                .map(|_| BYTES[rng.below(BYTES.len())])
                .collect::<Vec<_>>();
            let consumed = match rng.below(3) {
                0 => bytes.len(),
                1 => rng.below(bytes.len()),
                _ => 0,
            };
            OutputChunk {
                sequence: sequence as u64,
                stream,
                stream_start: 0,
                combined_start: 0,
                bytes,
                consumed,
            }
        })
        .collect::<VecDeque<_>>();
    let retained_bytes = chunks.iter().map(OutputChunk::retained_len).sum();
    Artifact {
        created_sequence: 0,
        active: false,
        kind,
        model_visible: true,
        sanitized: false,
        chunks,
        stdout_bytes: 0,
        stderr_bytes: 0,
        combined_bytes: 0,
        retained_bytes,
        overflowed: false,
    }
}

#[test]
fn boundary_scan_early_exit_matches_the_full_scan() {
    for seed in 0..20_000 {
        let mut rng = Rng::new(seed);
        let artifact = random_artifact(&mut rng);
        assert_eq!(
            prefix_to_unaligned_stream_boundary(&artifact),
            full_scan_unaligned_stream_boundary(&artifact),
            "seed {seed}"
        );
    }
}

#[test]
fn session_cap_evicts_from_the_globally_oldest_chunk_first() {
    let registry = OutputRegistry::new(CommandOutputLimits {
        per_command_bytes: 64,
        per_session_bytes: 64,
    })
    .unwrap();
    let leases = (0..6)
        .map(|_| registry.create(ArtifactKind::Command).unwrap())
        .collect::<Vec<_>>();
    let ids = leases
        .iter()
        .map(|lease| lease.output_id().to_string())
        .collect::<Vec<_>>();
    let retained = |registry: &OutputRegistry| {
        ids.iter()
            .map(|id| registry.stats(id).unwrap().retained_bytes)
            .collect::<Vec<_>>()
    };
    // Interleave the artifacts so chunk age differs from creation order.
    for (index, stream) in [(2, OutputStream::Stdout), (0, OutputStream::Stderr)] {
        registry
            .append(&ids[index], stream, vec![b'a'; 16])
            .unwrap();
    }
    for (index, stream) in [(4, OutputStream::Stdout), (1, OutputStream::Stdout)] {
        registry
            .append(&ids[index], stream, vec![b'b'; 16])
            .unwrap();
    }
    assert_eq!(retained(&registry), vec![16, 16, 16, 0, 16, 0]);

    // Each further 16-byte append evicts exactly the oldest remaining chunk.
    registry
        .append(&ids[3], OutputStream::Stdout, vec![b'c'; 16])
        .unwrap();
    assert_eq!(retained(&registry), vec![16, 16, 0, 16, 16, 0]);
    registry
        .append(&ids[5], OutputStream::Stderr, vec![b'd'; 16])
        .unwrap();
    assert_eq!(retained(&registry), vec![0, 16, 0, 16, 16, 16]);
    // A larger append drains the next two oldest chunks, then part of a third.
    registry
        .append(&ids[0], OutputStream::Stdout, vec![b'e'; 40])
        .unwrap();
    assert_eq!(retained(&registry), vec![40, 0, 0, 8, 0, 16]);
    assert_eq!(registry.retained_bytes(), 64);
}
