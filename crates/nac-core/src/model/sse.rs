//! Incremental reader for the SSE bodies the streaming model backends return.
//!
//! Every provider frames its stream the same way (the SSE spec): a field per
//! line, an event terminated by a blank line. The one subtlety is that a single
//! network read can split a frame anywhere, so a partial line has to survive
//! across reads — dispatching only on blank-line boundaries is what makes the
//! deltas arrive as the model produces them instead of when the body closes.
//!
//! `data: [DONE]` is left to the caller: it is a wire-only sentinel that only
//! the OpenAI-shaped backends send.

use std::pin::Pin;

use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use reqwest::Response;
use serde_json::Value;

/// Rebuilds the response body a provider's buffered endpoint would have returned
/// out of the events its streaming endpoint sends, so the existing parsers stay
/// the single place that understands each provider's response shape.
pub(super) trait StreamFold {
    /// Fold one event. `Err` is terminal and carries a user-facing reason.
    fn push(&mut self, event: &Value) -> std::result::Result<(), String>;

    fn finish(self) -> std::result::Result<Value, String>;
}

/// Read an SSE body to completion, folding it into a response value.
pub(super) async fn read_sse_response<F: StreamFold>(
    url: &str,
    response: Response,
    mut fold: F,
) -> Result<Value> {
    let mut reader = SseReader::new(response);

    while let Some(frame) = reader.next_frame().await {
        let frame = frame.with_context(|| format!("model stream from {url} failed"))?;
        if frame.is_done() || frame.data.trim().is_empty() {
            continue;
        }
        let event: Value = serde_json::from_str(&frame.data)
            .with_context(|| format!("invalid SSE event from {url}: {}", frame.data))?;
        fold.push(&event)
            .map_err(|message| anyhow!("model stream from {url} failed: {message}"))?;
    }

    fold.finish()
        .map_err(|message| anyhow!("model stream from {url} failed: {message}"))
}

/// One dispatched SSE event. Only the payload is kept: providers that also name
/// their frames on an `event:` line repeat that name inside the payload, and the
/// folds all dispatch on the payload.
pub(super) struct SseFrame {
    pub data: String,
}

impl SseFrame {
    /// The OpenAI-style stream terminator, which carries no payload.
    pub fn is_done(&self) -> bool {
        self.data == "[DONE]"
    }
}

type ByteStream = Pin<Box<dyn Stream<Item = reqwest::Result<Bytes>> + Send>>;

pub(super) struct SseReader {
    body: ByteStream,
    /// Text read but not yet terminated by a newline.
    pending_line: String,
    data_lines: Vec<String>,
}

impl SseReader {
    pub fn new(response: Response) -> Self {
        Self {
            body: Box::pin(response.bytes_stream()),
            pending_line: String::new(),
            data_lines: Vec::new(),
        }
    }

    /// The next complete frame, or `None` once the body ends. A frame the
    /// server left unterminated is still returned, so a stream that closes
    /// right after its last `data:` line does not lose it.
    pub async fn next_frame(&mut self) -> Option<Result<SseFrame>> {
        loop {
            if let Some(line) = self.take_line() {
                match self.consume_line(&line) {
                    Some(frame) => return Some(Ok(frame)),
                    None => continue,
                }
            }

            match self.body.next().await {
                Some(Ok(chunk)) => match std::str::from_utf8(&chunk) {
                    Ok(text) => self.pending_line.push_str(text),
                    // Provider bodies are JSON, so a split multi-byte sequence
                    // is the only realistic cause; recover the valid prefix and
                    // let the JSON parse surface anything worse.
                    Err(error) => {
                        let (valid, _) = chunk.split_at(error.valid_up_to());
                        self.pending_line.push_str(&String::from_utf8_lossy(valid));
                    }
                },
                Some(Err(error)) => {
                    return Some(Err(anyhow!("model stream failed mid-response: {error}")))
                }
                None => return self.flush().map(Ok),
            }
        }
    }

    fn take_line(&mut self) -> Option<String> {
        let end = self.pending_line.find('\n')?;
        let line = self.pending_line[..end].trim_end_matches('\r').to_string();
        self.pending_line.drain(..=end);
        Some(line)
    }

    /// Fold one field line into the frame being assembled, returning the frame
    /// once the blank line that terminates it arrives.
    fn consume_line(&mut self, line: &str) -> Option<SseFrame> {
        if line.is_empty() {
            return self.flush();
        }
        // Comments (`: keep-alive`) carry no fields.
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

    fn flush(&mut self) -> Option<SseFrame> {
        if self.data_lines.is_empty() {
            return None;
        }
        Some(SseFrame {
            data: std::mem::take(&mut self.data_lines).join("\n"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drive the line machine directly: it is the part that has to survive
    /// frames split across reads, and it is independent of the transport.
    fn frames(chunks: &[&str]) -> Vec<String> {
        let mut reader = SseReader {
            body: Box::pin(futures_util::stream::empty()),
            pending_line: String::new(),
            data_lines: Vec::new(),
        };
        let mut out = Vec::new();
        for chunk in chunks {
            reader.pending_line.push_str(chunk);
            while let Some(line) = reader.take_line() {
                if let Some(frame) = reader.consume_line(&line) {
                    out.push(frame.data);
                }
            }
        }
        if let Some(frame) = reader.flush() {
            out.push(frame.data);
        }
        out
    }

    #[test]
    fn dispatches_named_and_default_frames_on_blank_lines() {
        assert_eq!(
            frames(&["data: {\"a\":1}\n\nevent: done\ndata: {}\n\n"]),
            vec!["{\"a\":1}".to_string(), "{}".to_string()]
        );
    }

    #[test]
    fn holds_a_frame_split_across_reads() {
        assert_eq!(
            frames(&["data: {\"te", "xt\":\"hi\"}", "\n\n"]),
            vec!["{\"text\":\"hi\"}".to_string()]
        );
    }

    #[test]
    fn joins_multi_line_data_and_ignores_comments_and_crlf() {
        assert_eq!(
            frames(&[": keep-alive\r\ndata: one\r\ndata: two\r\n\r\n"]),
            vec!["one\ntwo".to_string()]
        );
    }

    #[test]
    fn returns_a_trailing_frame_the_server_left_unterminated() {
        assert_eq!(frames(&["data: [DONE]\n"]), vec!["[DONE]".to_string()]);
    }
}
