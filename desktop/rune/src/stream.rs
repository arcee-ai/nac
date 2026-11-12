//! The session event stream (`GET /sessions/{id}/events/stream`, server-sent events) on its own
//! thread. Follows the rules of the web client's `packages/nac-client/src/eventStream.ts`:
//!
//! - `session_event` records carry `(epoch_id, sequence_id)`. One at or before the cursor is a
//!   duplicate and dropped. One that skips a sequence number closes the connection and replays
//!   from the last delivered event.
//! - A `replay_boundary` in a different epoch than the cursor means the server restarted its
//!   event log: the cursor moves to the boundary and the app reloads the snapshot.
//! - `replay_gap` and `lagged` mean events were lost for good: the app reloads the snapshot.
//! - `assistant_delta` has no sequence number and is never replayed.
//! - A dropped connection reconnects from the cursor after 0.5 s, doubling up to 10 s.

use std::io::{BufRead, BufReader};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;

use crate::api::{Boundary, Client};

const INITIAL_RETRY: Duration = Duration::from_millis(500);
const MAX_RETRY: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Link {
    Connecting,
    Live,
    Reconnecting,
}

pub enum Msg {
    Link(Link),
    /// A `SessionEvent` (the envelope's `event`).
    Event(Value),
    /// An `AssistantStreamDelta`.
    Delta(Value),
    /// Events were lost or the log restarted: reload the snapshot.
    Resync,
}

#[derive(Deserialize)]
struct Envelope {
    epoch_id: String,
    sequence_id: u64,
    event: Value,
}

#[derive(Deserialize)]
struct ReplayBoundary {
    epoch_id: String,
    replay_boundary_sequence_id: u64,
}

enum End {
    /// The connection ended or failed; `opened` says whether it ever answered 200.
    Dropped { opened: bool },
    Stopped,
}

/// Runs until `stop` is set. `deliver` is called from this thread.
pub fn run(client: &Client, session: &str, start: Option<Boundary>, stop: &Arc<AtomicBool>, deliver: &dyn Fn(Msg)) {
    let mut cursor = start;
    let mut retry = INITIAL_RETRY;
    deliver(Msg::Link(Link::Connecting));
    loop {
        match connection(client, session, &mut cursor, stop, deliver) {
            End::Stopped => return,
            End::Dropped { opened } => {
                if opened {
                    retry = INITIAL_RETRY;
                }
            }
        }
        if stop.load(Ordering::Relaxed) {
            return;
        }
        deliver(Msg::Link(Link::Reconnecting));
        std::thread::sleep(retry);
        retry = (retry * 2).min(MAX_RETRY);
    }
}

fn connection(client: &Client, session: &str, cursor: &mut Option<Boundary>, stop: &Arc<AtomicBool>, deliver: &dyn Fn(Msg)) -> End {
    let Ok(reader) = client.open_stream(session, cursor.as_ref()) else { return End::Dropped { opened: false } };
    deliver(Msg::Link(Link::Live));
    let mut reader = BufReader::new(reader);
    let (mut name, mut data, mut line) = (String::new(), String::new(), String::new());
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return End::Dropped { opened: true },
            Ok(_) => {}
        }
        if stop.load(Ordering::Relaxed) {
            return End::Stopped;
        }
        let text = line.trim_end_matches(['\r', '\n']);
        if !text.is_empty() {
            // A line starting with ':' is a comment (the keep-alive).
            if let Some(v) = text.strip_prefix("event:") {
                name = v.trim().to_owned();
            } else if let Some(v) = text.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(v.strip_prefix(' ').unwrap_or(v));
            }
            continue;
        }
        let (event, payload) = (std::mem::take(&mut name), std::mem::take(&mut data));
        match event.as_str() {
            "session_event" => {
                let Ok(envelope) = serde_json::from_str::<Envelope>(&payload) else { continue };
                if let Some(c) = cursor.as_ref().filter(|c| c.epoch_id == envelope.epoch_id) {
                    if envelope.sequence_id <= c.sequence_id {
                        continue;
                    }
                    if envelope.sequence_id != c.sequence_id + 1 {
                        return End::Dropped { opened: true };
                    }
                }
                *cursor = Some(Boundary { epoch_id: envelope.epoch_id, sequence_id: envelope.sequence_id });
                deliver(Msg::Event(envelope.event));
            }
            "assistant_delta" => {
                if let Ok(delta) = serde_json::from_str::<Value>(&payload) {
                    deliver(Msg::Delta(delta));
                }
            }
            "replay_boundary" => {
                let Ok(b) = serde_json::from_str::<ReplayBoundary>(&payload) else { continue };
                match cursor {
                    Some(c) if c.epoch_id != b.epoch_id => {
                        *cursor = Some(Boundary { epoch_id: b.epoch_id, sequence_id: b.replay_boundary_sequence_id });
                        deliver(Msg::Resync);
                    }
                    None => *cursor = Some(Boundary { epoch_id: b.epoch_id, sequence_id: b.replay_boundary_sequence_id }),
                    Some(_) => {}
                }
            }
            "replay_gap" | "lagged" => deliver(Msg::Resync),
            _ => {}
        }
    }
}
