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
/// Each stream gets its own instance. Live delivery and replay use the resulting
/// sanitized bytes rather than re-masking raw pages. Rendered text selections
/// receive an independent finite pass with the exact launch policy.
/// This type intentionally implements neither Debug nor serialization.
pub struct CommandOutputRedactor {
    patterns: Vec<Pattern>,
    pending: VecDeque<u8>,
    masked: VecDeque<Range<u64>>,
    consumed: u64,
    emitted: u64,
    in_redaction: bool,
}

/// Sanitized finite plain text and the transformations applied before masking.
/// Counts describe input normalization, including CRLF/CR conversion to LF.
pub struct RedactedCommandPlainText {
    pub text: String,
    pub controls_removed: usize,
    pub line_endings_normalized: usize,
}

fn plain_text(text: &str) -> RedactedCommandPlainText {
    let mut projected = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut controls_removed = 0;
    let mut line_endings_normalized = 0;
    while let Some(character) = chars.next() {
        if character == '\r' {
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            projected.push('\n');
            line_endings_normalized += 1;
        } else if character.is_control() && character != '\n' && character != '\t' {
            controls_removed += 1;
        } else {
            projected.push(character);
        }
    }
    RedactedCommandPlainText {
        text: projected,
        controls_removed,
        line_endings_normalized,
    }
}

impl CommandOutputRedactor {
    /// Masks a finite plain-text selection with both exact launch values and
    /// their identical plain-text projection. Controls removed from a value
    /// must not make it escape masking when the selected text is normalized.
    /// This is independent of live stream state and is not idempotent: fixed
    /// replacement markers may themselves contain a configured secret pattern.
    pub fn redact_plain_text(
        &self,
        text: &str,
    ) -> Result<RedactedCommandPlainText, std::string::FromUtf8Error> {
        let mut result = plain_text(text);
        let mut values = Vec::with_capacity(self.patterns.len() * 2);
        for pattern in &self.patterns {
            // Patterns originate exclusively from UTF-8 credential Strings.
            if let Ok(value) = std::str::from_utf8(&pattern.bytes) {
                values.push(value.to_owned());
                values.push(plain_text(value).text);
            }
        }
        let mut sanitizer = Self::new(&values);
        let mut bytes = sanitizer.push(result.text.as_bytes());
        bytes.extend(sanitizer.finish());
        result.text = String::from_utf8(bytes)?;
        Ok(result)
    }

    /// Starts an independent finite-text sanitizer with the same immutable
    /// secret patterns, without copying any pending bytes or stream position.
    /// Rendered selections need their own pass: screen edits may assemble a
    /// value that was not contiguous in the original sanitized byte stream.
    pub fn fresh(&self) -> Self {
        Self {
            patterns: self
                .patterns
                .iter()
                .map(|pattern| Pattern {
                    bytes: pattern.bytes.clone(),
                    failure: pattern.failure.clone(),
                    prefix: 0,
                })
                .collect(),
            pending: VecDeque::new(),
            masked: VecDeque::new(),
            consumed: 0,
            emitted: 0,
            in_redaction: false,
        }
    }

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
