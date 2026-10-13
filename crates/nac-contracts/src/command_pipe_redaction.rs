//! One bounded sanitizer for interleaved stdout/stderr, retaining origin.
use std::collections::VecDeque;

use super::command_output_redaction::Pattern;

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

    pub fn push(&mut self, stderr: bool, bytes: &[u8]) -> Vec<(bool, Vec<u8>)> {
        let stream = usize::from(stderr);
        let mut output = Vec::new();
        for &byte in bytes {
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

    pub fn finish(mut self) -> Vec<(bool, Vec<u8>)> {
        let mut output = Vec::new();
        while !self.pending.is_empty() {
            self.emit(false, &mut output);
        }
        output
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
