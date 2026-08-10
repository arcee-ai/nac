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

    /// Whether a protocol-level terminal event has been folded. Streaming
    /// callers can stop here instead of waiting for the provider to close an
    /// otherwise complete SSE body.
    fn is_complete(&self) -> bool {
        false
    }

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
        if frame.is_done() {
            break;
        }
        if frame.data.trim().is_empty() {
            continue;
        }
        let event: Value = serde_json::from_str(&frame.data)
            .with_context(|| format!("invalid SSE event from {url}: {}", frame.data))?;
        fold.push(&event)
            .map_err(|message| anyhow!("model stream from {url} failed: {message}"))?;
        if fold.is_complete() {
            break;
        }
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
    /// Incomplete UTF-8 sequence waiting for the rest of a multi-byte character
    /// that was split across network reads.
    pending_bytes: Vec<u8>,
    /// Text read but not yet terminated by a newline.
    pending_line: String,
    data_lines: Vec<String>,
}

impl SseReader {
    pub fn new(response: Response) -> Self {
        Self {
            body: Box::pin(response.bytes_stream()),
            pending_bytes: Vec::new(),
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
                Some(Ok(chunk)) => self.push_chunk(&chunk),
                Some(Err(error)) => {
                    return Some(Err(anyhow!("model stream failed mid-response: {error}")))
                }
                None => {
                    // A trailing incomplete sequence would only appear if the
                    // body itself is truncated mid-character; surface it as the
                    // replacement char so the JSON parse can fail loudly.
                    if !self.pending_bytes.is_empty() {
                        self.pending_line
                            .push_str(&String::from_utf8_lossy(&self.pending_bytes));
                        self.pending_bytes.clear();
                    }
                    return self.flush().map(Ok);
                }
            }
        }
    }

    /// Decode `chunk` into `pending_line`, carrying any incomplete trailing
    /// multi-byte sequence into `pending_bytes` for the next read.
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
                        // `valid_up_to` is the first invalid byte; the prefix is UTF-8.
                        self.pending_line.push_str(
                            std::str::from_utf8(&bytes[at..at + valid_up_to])
                                .expect("valid_up_to marks a UTF-8 prefix"),
                        );
                        at += valid_up_to;
                    }
                    match error.error_len() {
                        // Incomplete sequence at the end of this buffer — hold
                        // the bytes until the next chunk completes them.
                        None => {
                            self.pending_bytes.extend_from_slice(&bytes[at..]);
                            return;
                        }
                        // Hard invalid sequence mid-stream. Skip it with a
                        // replacement and keep decoding so a later JSON parse
                        // can surface the corruption.
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
    use crate::model::responses_stream::ResponsesStreamFold;
    use std::time::Instant;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use tokio::time::{timeout, Duration};

    /// Drive the line machine directly: it is the part that has to survive
    /// frames split across reads, and it is independent of the transport.
    fn frames(chunks: &[&str]) -> Vec<String> {
        let mut reader = SseReader {
            body: Box::pin(futures_util::stream::empty()),
            pending_bytes: Vec::new(),
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

    #[tokio::test]
    async fn responses_finish_on_terminal_event_before_body_closes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (release_server, wait_for_release) = oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            let event = concat!(
                "data: {\"type\":\"response.output_item.done\",\"output_index\":0,",
                "\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",",
                "\"call_id\":\"call_1\",\"name\":\"read\",",
                "\"arguments\":\"{\\\"path\\\":\\\"src/main.rs\\\"}\",",
                "\"status\":\"completed\"}}\n\n",
                "data: {\"type\":\"response.completed\",\"response\":",
                "{\"status\":\"completed\",\"output\":[]}}\n\n"
            );
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                      Transfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n",
                )
                .await
                .unwrap();
            stream
                .write_all(format!("{:X}\r\n{event}\r\n", event.len()).as_bytes())
                .await
                .unwrap();
            stream.flush().await.unwrap();

            let _ = wait_for_release.await;
            let _ = stream.write_all(b"0\r\n\r\n").await;
        });

        let response = reqwest::Client::new()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap();
        let result = timeout(
            Duration::from_secs(1),
            read_sse_response(
                "http://responses.test",
                response,
                ResponsesStreamFold::new(None),
            ),
        )
        .await;

        let _ = release_server.send(());
        server.await.unwrap();
        let response = result
            .expect("terminal response event should finish before the body closes")
            .unwrap();
        assert_eq!(response["status"], "completed");
        assert_eq!(response["output"][0]["type"], "function_call");
        assert_eq!(response["output"][0]["id"], "fc_1");
        assert_eq!(response["output"][0]["call_id"], "call_1");
    }

    async fn delayed_terminal_response(
        post_terminal_delay: Duration,
    ) -> (reqwest::Response, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            let event = concat!(
                "data: {\"type\":\"response.completed\",\"response\":",
                "{\"status\":\"completed\",\"output\":[]}}\n\n"
            );
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                      Transfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n",
                )
                .await
                .unwrap();
            stream
                .write_all(format!("{:X}\r\n{event}\r\n", event.len()).as_bytes())
                .await
                .unwrap();
            stream.flush().await.unwrap();
            tokio::time::sleep(post_terminal_delay).await;
            let _ = stream.write_all(b"0\r\n\r\n").await;
        });
        let response = reqwest::Client::new()
            .get(format!("http://{address}"))
            .send()
            .await
            .unwrap();
        (response, server)
    }

    async fn measure_buffered_eof(post_terminal_delay: Duration) -> Duration {
        let (response, server) = delayed_terminal_response(post_terminal_delay).await;
        let started = Instant::now();
        response.text().await.unwrap();
        let elapsed = started.elapsed();
        server.await.unwrap();
        elapsed
    }

    async fn measure_terminal_event(post_terminal_delay: Duration) -> Duration {
        let (response, server) = delayed_terminal_response(post_terminal_delay).await;
        let started = Instant::now();
        read_sse_response(
            "http://responses.benchmark",
            response,
            ResponsesStreamFold::new(None),
        )
        .await
        .unwrap();
        let elapsed = started.elapsed();
        server.await.unwrap();
        elapsed
    }

    fn summarize_latency(mut samples: Vec<Duration>) -> (Duration, Duration) {
        samples.sort_unstable();
        (
            samples[samples.len() / 2],
            samples[(samples.len() * 95).div_ceil(100) - 1],
        )
    }

    /// Manual comparison of the former EOF-buffered Codex path and terminal
    /// Responses event completion.
    ///
    /// Run with:
    /// `cargo test --release -p nac-core benchmark_responses_terminal_event_latency -- --ignored --nocapture`
    #[tokio::test]
    #[ignore = "manual Responses SSE latency benchmark"]
    async fn benchmark_responses_terminal_event_latency() {
        const SAMPLES: usize = 30;
        const POST_TERMINAL_DELAY: Duration = Duration::from_millis(20);

        let _ = measure_buffered_eof(POST_TERMINAL_DELAY).await;
        let _ = measure_terminal_event(POST_TERMINAL_DELAY).await;

        let mut buffered = Vec::with_capacity(SAMPLES);
        let mut terminal = Vec::with_capacity(SAMPLES);
        for sample in 0..SAMPLES {
            if sample % 2 == 0 {
                buffered.push(measure_buffered_eof(POST_TERMINAL_DELAY).await);
                terminal.push(measure_terminal_event(POST_TERMINAL_DELAY).await);
            } else {
                terminal.push(measure_terminal_event(POST_TERMINAL_DELAY).await);
                buffered.push(measure_buffered_eof(POST_TERMINAL_DELAY).await);
            }
        }

        let (buffered_median, buffered_p95) = summarize_latency(buffered);
        let (terminal_median, terminal_p95) = summarize_latency(terminal);
        println!(
            "Responses SSE completion latency ({SAMPLES} samples, \
             {}ms post-terminal keep-alive):",
            POST_TERMINAL_DELAY.as_millis()
        );
        println!("buffered EOF: median={buffered_median:?}, p95={buffered_p95:?}");
        println!("terminal event: median={terminal_median:?}, p95={terminal_p95:?}");
    }
}
