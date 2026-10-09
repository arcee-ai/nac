//! Exact-value masking before command bytes become retained or observable.

use std::collections::VecDeque;
use std::ops::Range;

const REDACTED: &[u8] = b"[REDACTED]";

struct Pattern {
    bytes: Vec<u8>,
    failure: Vec<usize>,
    prefix: usize,
}

impl Pattern {
    fn new(value: &str) -> Self {
        let bytes = value.as_bytes().to_vec();
        let mut failure = vec![0; bytes.len()];
        let mut prefix = 0;
        for index in 1..bytes.len() {
            while prefix > 0 && bytes[index] != bytes[prefix] {
                prefix = failure[prefix - 1];
            }
            if bytes[index] == bytes[prefix] {
                prefix += 1;
            }
            failure[index] = prefix;
        }
        Self {
            bytes,
            failure,
            prefix: 0,
        }
    }

    fn advance(&mut self, byte: u8) -> bool {
        while self.prefix > 0 && byte != self.bytes[self.prefix] {
            self.prefix = self.failure[self.prefix - 1];
        }
        if byte == self.bytes[self.prefix] {
            self.prefix += 1;
        }
        if self.prefix == self.bytes.len() {
            self.prefix = self.failure[self.prefix - 1];
            true
        } else {
            false
        }
    }
}

/// A single process output stream bound to its launch-time secret snapshot.
///
/// Non-secret bytes, including invalid UTF-8 and terminal controls, pass through
/// unchanged. Overlapping or adjacent complete matches are masked as one run.
/// Only a suffix that might complete a known secret is withheld, bounded by the
/// longest secret minus one byte. An idle ambiguous suffix must not be flushed
/// on a timer: doing so could expose a secret split across future reads.
///
/// Each stream gets its own instance. Live delivery, replay and attachments must
/// all use the resulting sanitized bytes rather than re-masking raw pages.
/// This type intentionally implements neither Debug nor serialization.
pub struct CommandOutputRedactor {
    patterns: Vec<Pattern>,
    pending: VecDeque<u8>,
    masked: VecDeque<Range<u64>>,
    consumed: u64,
    emitted: u64,
    in_redaction: bool,
}

impl CommandOutputRedactor {
    pub(crate) fn new(values: &[String]) -> Self {
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

    /// Returns only bytes whose masking can no longer change with future input.
    /// A processing acknowledgement may cover these bytes after rendering.
    pub fn push(&mut self, bytes: &[u8]) -> Vec<u8> {
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

    /// Consumes the stream at confirmed EOF, flushing any incomplete prefix.
    /// Ownership consumption prevents an unsafe mid-stream flush and reuse.
    pub fn finish(mut self) -> Vec<u8> {
        let mut output = Vec::new();
        self.emit(self.pending.len(), &mut output);
        output
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

#[cfg(test)]
#[path = "command_output_redaction_tests.rs"]
mod tests;
