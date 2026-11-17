//! One bounded sanitizer for interleaved stdout/stderr, retaining origin.
use std::collections::VecDeque;

use super::command_output_redaction::{inert_prefix_len, pattern_starts, Pattern};

/// Consumed count, per-stream positions, pending bytes, redaction-run flags
/// and per-lane pattern prefixes.
#[cfg(test)]
pub(crate) type PipeStateForTest = (
    u64,
    [Vec<u64>; 2],
    Vec<(u64, usize, u8, bool)>,
    [bool; 2],
    [Vec<usize>; 3],
);

struct PendingByte {
    position: u64,
    stream: usize,
    byte: u8,
    masked: bool,
}

/// Sanitizes original bytes once, checking stdout, stderr and observed order.
/// The bool tag is stderr. A stalled prefix on one pipe cannot retain unlimited
/// bytes from the other: after twice the longest pattern, ambiguous bytes are
/// conservatively masked. Match state remains intact so later suffixes are also
/// masked. Errors discard pending bytes; only confirmed EOF calls `finish`.
/// Private credential patterns have no Debug/serialization representation.
pub struct CommandPipeRedactor {
    patterns: [Vec<Pattern>; 3],
    /// Bytes that begin at least one pattern; every lane holds the same values.
    starts: [bool; 256],
    positions: [VecDeque<u64>; 2],
    pending: VecDeque<PendingByte>,
    consumed: u64,
    longest: usize,
    masked: [bool; 2],
}

impl CommandPipeRedactor {
    pub(super) fn new(values: &[String]) -> Self {
        let values = values
            .iter()
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        let longest = values.iter().map(|value| value.len()).max().unwrap_or(0);
        let patterns: [Vec<Pattern>; 3] =
            std::array::from_fn(|_| values.iter().map(|value| Pattern::new(value)).collect());
        Self {
            starts: pattern_starts(&patterns[2]),
            patterns,
            positions: Default::default(),
            pending: VecDeque::new(),
            consumed: 0,
            longest,
            masked: [false; 2],
        }
    }

    pub fn push(&mut self, stderr: bool, bytes: &[u8]) -> Vec<(bool, Vec<u8>)> {
        let stream = usize::from(stderr);
        let mut output = Vec::new();
        if self.longest == 0 {
            // Without patterns nothing is withheld or masked.
            while !self.pending.is_empty() {
                self.emit(false, &mut output);
            }
            self.copy_through(stream, bytes, bytes.len(), &mut output);
            return output;
        }
        let mut index = 0;
        while index < bytes.len() {
            // A live prefix in any lane always withholds the newest byte, so an
            // empty queue means no lane is mid-match. A byte that cannot begin
            // a pattern then leaves every match and hold unchanged and is
            // emitted unmasked, exactly as the per-byte path below would.
            if self.pending.is_empty() {
                let run = inert_prefix_len(&self.starts, &bytes[index..]);
                if run > 0 {
                    let capacity = bytes.len() - index;
                    self.copy_through(stream, &bytes[index..index + run], capacity, &mut output);
                    index += run;
                    continue;
                }
            }
            self.push_byte(stream, bytes[index], &mut output);
            index += 1;
        }
        output
    }

    fn push_byte(&mut self, stream: usize, byte: u8, output: &mut Vec<(bool, Vec<u8>)>) {
        let position = self.consumed;
        self.consumed += 1;
        self.pending.push_back(PendingByte {
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
                            pending.masked |= pending.stream == stream && pending.position >= start;
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
            self.emit(forced, output);
        }
    }

    /// Emits bytes that can neither begin nor continue a match, recording the
    /// same stream positions and redaction-run state as per-byte emission.
    fn copy_through(
        &mut self,
        stream: usize,
        run: &[u8],
        capacity: usize,
        output: &mut Vec<(bool, Vec<u8>)>,
    ) {
        if run.is_empty() {
            return;
        }
        let window = self.longest.max(1);
        let end = self.consumed + run.len() as u64;
        let positions = &mut self.positions[stream];
        for position in end - run.len().min(window) as u64..end {
            positions.push_back(position);
            if positions.len() > window {
                positions.pop_front();
            }
        }
        self.consumed = end;
        self.masked[stream] = false;
        let stderr = stream == 1;
        if let Some((_, previous)) = output.last_mut().filter(|(tag, _)| *tag == stderr) {
            previous.extend_from_slice(run);
        } else {
            let mut chunk = Vec::with_capacity(capacity.max(run.len()));
            chunk.extend_from_slice(run);
            output.push((stderr, chunk));
        }
    }

    pub fn finish(mut self) -> Vec<(bool, Vec<u8>)> {
        let mut output = Vec::new();
        while !self.pending.is_empty() {
            self.emit(false, &mut output);
        }
        output
    }

    /// Complete matching state, compared against the per-byte oracle.
    #[cfg(test)]
    pub(crate) fn state_for_test(&self) -> PipeStateForTest {
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
                b"[REDACTED]"
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

#[cfg(test)]
mod tests {
    use super::*;

    fn flatten(chunks: &[(bool, Vec<u8>)], stream: Option<bool>) -> Vec<u8> {
        chunks
            .iter()
            .filter(|(tag, _)| stream.is_none_or(|stream| stream == *tag))
            .flat_map(|(_, bytes)| bytes.clone())
            .collect()
    }

    #[test]
    fn masks_split_overlapping_control_secrets_in_each_and_combined_stream() {
        for split in 1..6 {
            let mut redactor = CommandPipeRedactor::new(&[
                "secret".into(),
                "cret-value".into(),
                "s\x1becret".into(),
            ]);
            let mut chunks = redactor.push(false, &b"secret"[..split]);
            chunks.extend(redactor.push(true, &b"secret"[split..]));
            chunks.extend(redactor.push(false, b" s\x1becret sec"));
            chunks.extend(redactor.push(true, b"visible"));
            chunks.extend(redactor.push(false, b"ret-value tail"));
            chunks.extend(redactor.finish());
            for stream in [None, Some(false), Some(true)] {
                let bytes = flatten(&chunks, stream);
                for secret in [b"secret".as_slice(), b"cret-value", b"s\x1becret"] {
                    assert!(
                        !bytes.windows(secret.len()).any(|window| window == secret),
                        "{bytes:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn stalled_stream_is_bounded_and_eof_keeps_safe_suffix() {
        let mut redactor = CommandPipeRedactor::new(&["secret".into()]);
        let mut chunks = redactor.push(false, b"sec");
        chunks.extend(redactor.push(true, &[b'x'; 10000]));
        assert!(redactor.pending.len() <= 12);
        chunks.extend(redactor.push(false, b"ret sec"));
        chunks.extend(redactor.finish());
        let stdout = flatten(&chunks, Some(false));
        assert_eq!(stdout, b"[REDACTED] sec");
        assert_eq!(flatten(&chunks, Some(true)), vec![b'x'; 10000]);
    }
}
