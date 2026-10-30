//! Differential checks for the bulk-copy redactors. The original per-byte
//! algorithms are kept here verbatim as oracles; every push and finish must
//! return byte-identical chunks, including stream tags and chunk boundaries.

use std::collections::VecDeque;
use std::ops::Range;

use crate::command_output_redaction::{OutputStateForTest, Pattern};
use crate::command_pipe_redaction::PipeStateForTest;
use crate::{CommandOutputRedactor, CommandPipeRedactor};

const REDACTED: &[u8] = b"[REDACTED]";

struct OraclePendingByte {
    position: u64,
    stream: usize,
    byte: u8,
    masked: bool,
}

/// The pipe redactor before bulk copying, unchanged.
struct OraclePipeRedactor {
    patterns: [Vec<Pattern>; 3],
    positions: [VecDeque<u64>; 2],
    pending: VecDeque<OraclePendingByte>,
    consumed: u64,
    longest: usize,
    masked: [bool; 2],
}

impl OraclePipeRedactor {
    fn new(values: &[String]) -> Self {
        let values = values
            .iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        let longest = values.iter().map(|value| value.len()).max().unwrap_or(0);
        Self {
            patterns: std::array::from_fn(|_| {
                values.iter().map(|value| Pattern::new(value)).collect()
            }),
            positions: Default::default(),
            pending: VecDeque::new(),
            consumed: 0,
            longest,
            masked: [false; 2],
        }
    }

    fn push(&mut self, stderr: bool, bytes: &[u8]) -> Vec<(bool, Vec<u8>)> {
        let stream = usize::from(stderr);
        let mut output = Vec::new();
        for &byte in bytes {
            let position = self.consumed;
            self.consumed += 1;
            self.pending.push_back(OraclePendingByte {
                position,
                stream,
                byte,
                masked: false,
            });
            self.positions[stream].push_back(position);
            if self.positions[stream].len() > self.longest.max(1) {
                self.positions[stream].pop_front();
            }
            for lane in [stream, 2] {
                for pattern in &mut self.patterns[lane] {
                    if pattern.advance(byte) {
                        if lane == 2 {
                            let start = self.consumed - pattern.bytes.len() as u64;
                            for pending in &mut self.pending {
                                pending.masked |= pending.position >= start;
                            }
                        } else {
                            let start = self.positions[stream]
                                [self.positions[stream].len() - pattern.bytes.len()];
                            for pending in &mut self.pending {
                                pending.masked |=
                                    pending.stream == stream && pending.position >= start;
                            }
                        }
                    }
                }
            }
            let mut held = self.consumed;
            let mut holds = [self.consumed; 3];
            for (lane, hold) in holds.iter_mut().enumerate() {
                for pattern in &self.patterns[lane] {
                    if pattern.prefix > 0 {
                        let start = if lane == 2 {
                            self.consumed - pattern.prefix as u64
                        } else {
                            self.positions[lane][self.positions[lane].len() - pattern.prefix]
                        };
                        held = held.min(start);
                        *hold = (*hold).min(start);
                    }
                }
            }
            while self
                .pending
                .front()
                .is_some_and(|pending| pending.position < held)
                || self.pending.len() > self.longest.saturating_mul(2).max(1)
            {
                let forced = self.pending.front().is_some_and(|pending| {
                    pending.position >= holds[pending.stream] || pending.position >= holds[2]
                });
                self.emit(forced, &mut output);
            }
        }
        output
    }

    fn finish(mut self) -> Vec<(bool, Vec<u8>)> {
        let mut output = Vec::new();
        while !self.pending.is_empty() {
            self.emit(false, &mut output);
        }
        output
    }

    fn state(&self) -> PipeStateForTest {
        (
            self.consumed,
            self.positions.clone().map(Vec::from),
            self.pending
                .iter()
                .map(|pending| {
                    (
                        pending.position,
                        pending.stream,
                        pending.byte,
                        pending.masked,
                    )
                })
                .collect(),
            self.masked,
            std::array::from_fn(|lane| {
                self.patterns[lane]
                    .iter()
                    .map(|pattern| pattern.prefix)
                    .collect()
            }),
        )
    }

    fn emit(&mut self, forced: bool, output: &mut Vec<(bool, Vec<u8>)>) {
        let Some(pending) = self.pending.pop_front() else {
            return;
        };
        let masked = pending.masked || forced;
        let bytes: &[u8] = if masked {
            if self.masked[pending.stream] {
                &[]
            } else {
                REDACTED
            }
        } else {
            std::slice::from_ref(&pending.byte)
        };
        self.masked[pending.stream] = masked;
        if bytes.is_empty() {
            return;
        }
        let stderr = pending.stream == 1;
        if let Some((_, previous)) = output.last_mut().filter(|(tag, _)| *tag == stderr) {
            previous.extend_from_slice(bytes);
        } else {
            output.push((stderr, bytes.to_vec()));
        }
    }
}

/// The single-stream (PTY) redactor before bulk copying, unchanged.
struct OracleOutputRedactor {
    patterns: Vec<Pattern>,
    pending: VecDeque<u8>,
    masked: VecDeque<Range<u64>>,
    consumed: u64,
    emitted: u64,
    in_redaction: bool,
}

impl OracleOutputRedactor {
    fn new(values: &[String]) -> Self {
        let mut values = values
            .iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        values.sort_unstable();
        values.dedup();
        Self {
            patterns: values
                .into_iter()
                .map(|value| Pattern::new(value))
                .collect(),
            pending: VecDeque::new(),
            masked: VecDeque::new(),
            consumed: 0,
            emitted: 0,
            in_redaction: false,
        }
    }

    fn push(&mut self, bytes: &[u8]) -> Vec<u8> {
        let mut output = Vec::new();
        for &byte in bytes {
            self.pending.push_back(byte);
            self.consumed += 1;
            let mut longest_match = 0;
            let mut held = 0;
            for pattern in &mut self.patterns {
                if pattern.advance(byte) {
                    longest_match = longest_match.max(pattern.bytes.len());
                }
                held = held.max(pattern.prefix);
            }
            if longest_match > 0 {
                let mut start = self.consumed - longest_match as u64;
                while self.masked.back().is_some_and(|range| range.end >= start) {
                    if let Some(range) = self.masked.pop_back() {
                        start = start.min(range.start);
                    }
                }
                self.masked.push_back(start..self.consumed);
            }
            self.emit(self.pending.len() - held, &mut output);
        }
        output
    }

    fn finish(mut self) -> Vec<u8> {
        let mut output = Vec::new();
        self.emit(self.pending.len(), &mut output);
        output
    }

    fn state(&self) -> OutputStateForTest {
        (
            self.consumed,
            self.emitted,
            self.in_redaction,
            Vec::from(self.pending.clone()),
            Vec::from(self.masked.clone()),
            self.patterns.iter().map(|pattern| pattern.prefix).collect(),
        )
    }

    fn emit(&mut self, count: usize, output: &mut Vec<u8>) {
        for _ in 0..count {
            let Some(byte) = self.pending.pop_front() else {
                break;
            };
            while self
                .masked
                .front()
                .is_some_and(|range| range.end <= self.emitted)
            {
                self.masked.pop_front();
            }
            let masked = self
                .masked
                .front()
                .is_some_and(|range| range.start <= self.emitted);
            if masked {
                if !self.in_redaction {
                    output.extend_from_slice(REDACTED);
                }
            } else {
                output.push(byte);
            }
            self.in_redaction = masked;
            self.emitted += 1;
        }
    }
}

/// Deterministic xorshift64* generator; failures report the case seed.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, bound: usize) -> usize {
        (self.next() % bound as u64) as usize
    }

    fn chance(&mut self, percent: usize) -> bool {
        self.below(100) < percent
    }

    fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}

/// Small alphabets make overlapping, adjacent and partial matches common.
/// Multi-byte characters keep patterns valid UTF-8 while exercising
/// non-ASCII first and continuation bytes.
const PATTERN_ALPHABET: &[&str] = &["a", "b", "c", "\n", "é", "中"];

fn random_values(rng: &mut Rng) -> Vec<String> {
    let count = rng.below(5);
    let mut values = Vec::with_capacity(count);
    for _ in 0..count {
        if !values.is_empty() && rng.chance(15) {
            // Prefixes and suffixes of an existing value overlap it.
            let base: &String = rng.pick(&values);
            let chars = base.chars().collect::<Vec<_>>();
            let cut = rng.below(chars.len() + 1);
            let value = if rng.chance(50) {
                chars[..cut].iter().collect()
            } else {
                chars[cut..].iter().collect()
            };
            values.push(value);
            continue;
        }
        if rng.chance(5) {
            values.push(String::new());
            continue;
        }
        let length = 1 + rng.below(6);
        values.push((0..length).map(|_| *rng.pick(PATTERN_ALPHABET)).collect());
    }
    values
}

/// Mostly pattern-alphabet bytes, with inert runs, arbitrary binary noise
/// and occasional complete values so matches straddle chunk boundaries.
fn random_input(rng: &mut Rng, values: &[String], length: usize) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(length);
    while bytes.len() < length {
        match rng.below(10) {
            0..=4 => bytes.extend_from_slice(rng.pick(PATTERN_ALPHABET).as_bytes()),
            5 | 6 => {
                let run = 1 + rng.below(24);
                bytes.extend((0..run).map(|_| b'x' + (rng.below(3) as u8)));
            }
            7 => bytes.push(rng.next() as u8),
            _ => match values.get(rng.below(values.len().max(1))) {
                Some(value) => bytes.extend_from_slice(value.as_bytes()),
                None => bytes.push(b'a'),
            },
        }
    }
    bytes.truncate(length);
    bytes
}

fn random_chunks(rng: &mut Rng, input: &[u8]) -> Vec<Vec<u8>> {
    let mut chunks = Vec::new();
    let mut index = 0;
    while index < input.len() {
        if rng.chance(5) {
            chunks.push(Vec::new());
        }
        let length = match rng.below(4) {
            0 => 1,
            1 => 1 + rng.below(4),
            2 => 1 + rng.below(16),
            _ => 1 + rng.below(96),
        }
        .min(input.len() - index);
        chunks.push(input[index..index + length].to_vec());
        index += length;
    }
    chunks
}

fn compare_pipe(seed: u64, values: &[String], pushes: &[(bool, Vec<u8>)]) {
    let mut redactor = CommandPipeRedactor::new(values);
    let mut oracle = OraclePipeRedactor::new(values);
    for (index, (stderr, chunk)) in pushes.iter().enumerate() {
        assert_eq!(
            redactor.push(*stderr, chunk),
            oracle.push(*stderr, chunk),
            "seed {seed}, push {index}, values {values:?}"
        );
        assert_eq!(
            redactor.state_for_test(),
            oracle.state(),
            "seed {seed}, state after push {index}, values {values:?}"
        );
    }
    assert_eq!(
        redactor.finish(),
        oracle.finish(),
        "seed {seed}, finish, values {values:?}"
    );
}

fn compare_stream(seed: u64, values: &[String], chunks: &[Vec<u8>]) {
    let mut redactor = CommandOutputRedactor::new(values);
    let mut oracle = OracleOutputRedactor::new(values);
    for (index, chunk) in chunks.iter().enumerate() {
        assert_eq!(
            redactor.push(chunk),
            oracle.push(chunk),
            "seed {seed}, push {index}, values {values:?}"
        );
        assert_eq!(
            redactor.state_for_test(),
            oracle.state(),
            "seed {seed}, state after push {index}, values {values:?}"
        );
    }
    assert_eq!(
        redactor.finish(),
        oracle.finish(),
        "seed {seed}, finish, values {values:?}"
    );
}

#[test]
fn pipe_redactor_matches_the_per_byte_oracle_on_random_interleavings() {
    for seed in 0..3_000 {
        let mut rng = Rng::new(seed);
        let values = random_values(&mut rng);
        let length = rng.below(400);
        let input = random_input(&mut rng, &values, length);
        // Alternate streams in random bursts so lane-2 (observed order)
        // matches cross stdout/stderr boundaries and one stream can stall
        // while the other passes the bounded hold.
        let mut stderr = rng.chance(50);
        let pushes = random_chunks(&mut rng, &input)
            .into_iter()
            .map(|chunk| {
                if rng.chance(40) {
                    stderr = !stderr;
                }
                (stderr, chunk)
            })
            .collect::<Vec<_>>();
        compare_pipe(seed, &values, &pushes);
    }
}

#[test]
fn pipe_redactor_matches_the_oracle_when_one_stream_stalls_mid_secret() {
    for seed in 0..500 {
        let mut rng = Rng::new(seed);
        let mut values = random_values(&mut rng);
        values.push("secret-token".to_string());
        let stalled = rng.chance(50);
        let cut = 1 + rng.below("secret-token".len() - 1);
        let other_length = rng.below(80);
        let other = random_input(&mut rng, &values, other_length);
        let mut pushes = vec![(stalled, b"secret-token"[..cut].to_vec())];
        pushes.extend(
            random_chunks(&mut rng, &other)
                .into_iter()
                .map(|c| (!stalled, c)),
        );
        pushes.push((stalled, b"secret-token"[cut..].to_vec()));
        let tail_length = rng.below(40);
        let tail = random_input(&mut rng, &values, tail_length);
        pushes.extend(
            random_chunks(&mut rng, &tail)
                .into_iter()
                .map(|c| (rng.chance(50), c)),
        );
        compare_pipe(seed, &values, &pushes);
    }
}

#[test]
fn pipe_redactor_matches_the_oracle_on_long_mostly_inert_streams() {
    let line = b"cargo test --release: compiling crate foo v0.1.0 (/src/foo) ok\n";
    let value_sets = [
        Vec::new(),
        vec![String::new()],
        vec![
            "sk-test-0123456789abcdef".to_string(),
            "ghp_abc".to_string(),
        ],
        (0..8)
            .map(|index| format!("secret-value-{index}-0123456789"))
            .collect(),
        vec!["o".to_string(), "ok\ncargo".to_string(), "\n".to_string()],
    ];
    for (set, values) in value_sets.iter().enumerate() {
        for seed in 0..40 {
            let mut rng = Rng::new(seed);
            let mut input = Vec::new();
            while input.len() < 16 * 1024 {
                if !values.is_empty() && rng.chance(10) {
                    input.extend_from_slice(rng.pick(values).as_bytes());
                }
                input.extend_from_slice(&line[..1 + rng.below(line.len())]);
            }
            let pushes = random_chunks(&mut rng, &input)
                .into_iter()
                .enumerate()
                .map(|(index, chunk)| (index % 3 == 1, chunk))
                .collect::<Vec<_>>();
            compare_pipe(set as u64 * 1_000 + seed, values, &pushes);
        }
    }
}

#[test]
fn stream_redactor_matches_the_per_byte_oracle_on_random_chunking() {
    for seed in 0..3_000 {
        let mut rng = Rng::new(seed);
        let values = random_values(&mut rng);
        let length = rng.below(400);
        let input = random_input(&mut rng, &values, length);
        let chunks = random_chunks(&mut rng, &input);
        compare_stream(seed, &values, &chunks);
    }
}

#[test]
fn stream_redactor_matches_the_oracle_on_long_mostly_inert_streams() {
    let line = b"cargo test --release: compiling crate foo v0.1.0 (/src/foo) ok\r\n";
    let value_sets = [
        Vec::new(),
        vec![
            "sk-test-0123456789abcdef".to_string(),
            "ghp_abc".to_string(),
        ],
        vec![
            "ok\r\ncargo".to_string(),
            "o".to_string(),
            "aba".to_string(),
        ],
    ];
    for (set, values) in value_sets.iter().enumerate() {
        for seed in 0..40 {
            let mut rng = Rng::new(seed);
            let mut input = Vec::new();
            while input.len() < 16 * 1024 {
                if !values.is_empty() && rng.chance(10) {
                    input.extend_from_slice(rng.pick(values).as_bytes());
                }
                input.extend_from_slice(&line[..1 + rng.below(line.len())]);
            }
            let chunks = random_chunks(&mut rng, &input);
            compare_stream(set as u64 * 1_000 + seed, values, &chunks);
        }
    }
}

#[test]
fn fresh_sanitizers_match_the_per_byte_oracle() {
    for seed in 0..500 {
        let mut rng = Rng::new(seed);
        let values = random_values(&mut rng);
        let length = rng.below(200);
        let input = random_input(&mut rng, &values, length);
        let chunks = random_chunks(&mut rng, &input);
        let mut original = CommandOutputRedactor::new(&values);
        let _ = original.push(&input);
        // A fresh sanitizer starts from clean state with the same patterns.
        compare_fresh(seed, &values, &mut original.fresh(), &chunks);
    }
}

fn compare_fresh(
    seed: u64,
    values: &[String],
    fresh: &mut CommandOutputRedactor,
    chunks: &[Vec<u8>],
) {
    let mut oracle = OracleOutputRedactor::new(values);
    for (index, chunk) in chunks.iter().enumerate() {
        assert_eq!(
            fresh.push(chunk),
            oracle.push(chunk),
            "seed {seed}, fresh push {index}, values {values:?}"
        );
        assert_eq!(
            fresh.state_for_test(),
            oracle.state(),
            "seed {seed}, fresh state after push {index}, values {values:?}"
        );
    }
}
