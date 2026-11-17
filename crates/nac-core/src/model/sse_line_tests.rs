//! The cursor-based line machine must dispatch exactly the frames of the
//! original per-line `drain` implementation, kept here as an oracle, for any
//! split of the byte stream into network reads.

use super::*;

/// The SSE line machine before cursor compaction, unchanged except that it
/// is driven synchronously instead of from a response body.
#[derive(Default)]
struct OracleLineMachine {
    pending_bytes: Vec<u8>,
    pending_line: String,
    data_lines: Vec<String>,
}

impl OracleLineMachine {
    fn frames(chunks: &[Vec<u8>]) -> Vec<String> {
        let mut machine = Self::default();
        let mut frames = Vec::new();
        for chunk in chunks {
            machine.push_chunk(chunk);
            while let Some(line) = machine.take_line() {
                if let Some(frame) = machine.consume_line(&line) {
                    frames.push(frame);
                }
            }
        }
        if !machine.pending_bytes.is_empty() {
            machine
                .pending_line
                .push_str(&String::from_utf8_lossy(&machine.pending_bytes));
            machine.pending_bytes.clear();
        }
        frames.extend(machine.flush());
        frames
    }

    fn push_chunk(&mut self, chunk: &[u8]) {
        if self.pending_bytes.is_empty() {
            self.decode_bytes(chunk);
            return;
        }
        self.pending_bytes.extend_from_slice(chunk);
        let bytes = std::mem::take(&mut self.pending_bytes);
        self.decode_bytes(&bytes);
    }

    fn decode_bytes(&mut self, bytes: &[u8]) {
        let mut at = 0;
        while at < bytes.len() {
            match std::str::from_utf8(&bytes[at..]) {
                Ok(text) => {
                    self.pending_line.push_str(text);
                    return;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    if valid_up_to > 0 {
                        self.pending_line
                            .push_str(std::str::from_utf8(&bytes[at..at + valid_up_to]).unwrap());
                        at += valid_up_to;
                    }
                    match error.error_len() {
                        None => {
                            self.pending_bytes.extend_from_slice(&bytes[at..]);
                            return;
                        }
                        Some(len) => {
                            self.pending_line.push('\u{FFFD}');
                            at += len;
                        }
                    }
                }
            }
        }
    }

    fn take_line(&mut self) -> Option<String> {
        let end = self.pending_line.find('\n')?;
        let line = self.pending_line[..end].trim_end_matches('\r').to_string();
        self.pending_line.drain(..=end);
        Some(line)
    }

    fn consume_line(&mut self, line: &str) -> Option<String> {
        if line.is_empty() {
            return self.flush();
        }
        if line.starts_with(':') {
            return None;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };
        if field == "data" {
            self.data_lines.push(value.to_string());
        }
        None
    }

    fn flush(&mut self) -> Option<String> {
        if self.data_lines.is_empty() {
            return None;
        }
        Some(std::mem::take(&mut self.data_lines).join("\n"))
    }
}

/// Drives the production reader through `next_frame` over the given reads.
async fn reader_frames(chunks: Vec<Vec<u8>>) -> Vec<String> {
    let body = futures_util::stream::iter(
        chunks
            .into_iter()
            .map(|chunk| Ok::<_, reqwest::Error>(Bytes::from(chunk))),
    );
    let mut reader = SseReader::from_body(Box::pin(body));
    let mut frames = Vec::new();
    while let Some(frame) = reader.next_frame().await {
        frames.push(frame.unwrap().data);
    }
    frames
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
}

/// SSE-shaped bytes: data/event/comment fields, LF and CRLF endings, blank
/// dispatch lines, multi-byte characters, invalid bytes and long lines.
fn random_stream(rng: &mut Rng) -> Vec<u8> {
    const PIECES: &[&[u8]] = &[
        b"data: {\"delta\":\"tok\"}",
        b"data:",
        b"data: [DONE]",
        b"event: message",
        b": keep-alive",
        b"id: 7",
        b"retry",
        b"data: \xe4\xb8\xad\xe6\x96\x87\xf0\x9f\x99\x82",
        b"data: \xff\xfe broken \xe4\xb8",
        b"\n",
        b"\r\n",
        b"\r",
        b"\n\n",
        b"\r\n\r\n",
    ];
    let mut bytes = Vec::new();
    for _ in 0..rng.below(60) {
        if rng.below(20) == 0 {
            bytes.extend(b"data: ");
            bytes.extend(std::iter::repeat_n(b'a', rng.below(5_000)));
        } else {
            bytes.extend_from_slice(PIECES[rng.below(PIECES.len())]);
        }
    }
    bytes
}

fn random_reads(rng: &mut Rng, bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut reads = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if rng.below(20) == 0 {
            reads.push(Vec::new());
        }
        let length = match rng.below(3) {
            0 => 1 + rng.below(3),
            1 => 1 + rng.below(64),
            _ => 1 + rng.below(4_096),
        }
        .min(bytes.len() - index);
        reads.push(bytes[index..index + length].to_vec());
        index += length;
    }
    reads
}

#[tokio::test]
async fn cursor_line_machine_dispatches_the_oracle_frames_for_any_read_split() {
    for seed in 0..1_500 {
        let mut rng = Rng::new(seed);
        let bytes = random_stream(&mut rng);
        let reads = random_reads(&mut rng, &bytes);
        let expected = OracleLineMachine::frames(&reads);
        assert_eq!(reader_frames(reads).await, expected, "seed {seed}");
        // The whole body in one read takes the many-lines-per-read path.
        assert_eq!(
            reader_frames(vec![bytes.clone()]).await,
            OracleLineMachine::frames(std::slice::from_ref(&bytes)),
            "seed {seed}, single read"
        );
    }
}

#[tokio::test]
async fn cursor_line_machine_matches_the_oracle_for_one_long_line_in_small_reads() {
    // The oracle rescans the whole pending line on every read, so line
    // lengths scale with the read size to keep it affordable.
    for (read, line) in [(1usize, 4 * 1024), (7, 32 * 1024), (16 * 1024, 1024 * 1024)] {
        let mut payload = b"data: {\"x\":\"".to_vec();
        payload.extend(std::iter::repeat_n(b'a', line));
        payload.extend(b"\"}\r\n\r\ndata: tail\n\n");
        let reads = payload.chunks(read).map(<[u8]>::to_vec).collect::<Vec<_>>();
        let expected = OracleLineMachine::frames(&reads);
        assert_eq!(reader_frames(reads).await, expected, "{read}-byte reads");
    }
}
