use super::*;

use crate::events::AgentEvent;
use crate::types::Message;
use serde::{Deserialize, Serialize};

const MAX_SNAPSHOT_BYTES: i64 = 2 * 1024 * 1024;
const MAX_EVENT_BYTES: i64 = 256 * 1024;
const MAX_PAYLOAD_CHARS: usize = 1_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum HistoryEventStream {
    All,
    Orchestrator,
    Thread { thread_name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub(crate) enum HistoryEventPhase {
    Events { before_id: Option<i64> },
    Snapshot { before_index: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HistoryEventSource {
    Snapshot,
    ThreadEvent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum HistoryEventStreamRef {
    Orchestrator,
    Thread { thread_name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct HistoryEventRecord {
    pub source: HistoryEventSource,
    pub source_id: i64,
    pub session_id: String,
    pub stream: HistoryEventStreamRef,
    pub event_type: String,
    pub created_at: Option<String>,
    /// JSON-encoded persisted payload excerpt. Kept as text so a bounded
    /// excerpt remains valid response JSON even when the original is large.
    pub payload_json: String,
    /// Character offset of payload_json within the original payload.
    pub payload_start_char: usize,
    pub payload_chars: usize,
    pub payload_truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HistoryEventPage {
    pub events: Vec<HistoryEventRecord>,
    pub next_phase: Option<HistoryEventPhase>,
    pub committed_through: Option<i64>,
}

struct RawEventRow {
    id: i64,
    thread_name: String,
    event_json: Option<String>,
    payload_chars: i64,
    payload_syntax_valid: bool,
    created_at: String,
}

pub(crate) fn load_session_history_events(
    path: &Path,
    session_id: &str,
    stream: &HistoryEventStream,
    contains: Option<&str>,
    phase: HistoryEventPhase,
    limit: usize,
) -> Result<HistoryEventPage> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction()?;
    let committed_through = tx.query_row(
        "SELECT MAX(id) FROM thread_events WHERE session_id = ?1",
        params![session_id],
        |row| row.get::<_, Option<i64>>(0),
    )?;

    let (events, next_phase) = match phase {
        HistoryEventPhase::Events { before_id } => {
            let snapshot_len = if stream_has_snapshot(stream) {
                snapshot_message_count(&tx, session_id)?
            } else {
                0
            };
            let (rows, has_older_events) = query_event_rows(
                &tx,
                session_id,
                stream,
                contains,
                before_id,
                limit,
                snapshot_len,
            )?;
            if rows.is_empty() {
                if let HistoryEventStream::Thread { thread_name } = stream {
                    if before_id.is_none() && !thread_stream_exists(&tx, session_id, thread_name)? {
                        return Err(anyhow!(
                            "thread_not_found: thread '{thread_name}' was not found in session '{session_id}'"
                        ));
                    }
                    (Vec::new(), None)
                } else {
                    load_snapshot_page(&tx, session_id, stream, contains, None, limit)?
                }
            } else {
                let oldest_id = rows.last().map(|row| row.id);
                let events = rows
                    .into_iter()
                    .rev()
                    .map(|row| normalize_event_row(session_id, row, contains))
                    .collect::<Result<Vec<_>>>()?;
                let next = if has_older_events {
                    oldest_id.map(|before_id| HistoryEventPhase::Events {
                        before_id: Some(before_id),
                    })
                } else if snapshot_len > 0 {
                    Some(HistoryEventPhase::Snapshot {
                        before_index: snapshot_len,
                    })
                } else {
                    None
                };
                (events, next)
            }
        }
        HistoryEventPhase::Snapshot { before_index } => {
            load_snapshot_page(&tx, session_id, stream, contains, Some(before_index), limit)?
        }
    };

    tx.commit()?;
    Ok(HistoryEventPage {
        events,
        next_phase,
        committed_through,
    })
}

fn query_event_rows(
    conn: &Connection,
    session_id: &str,
    stream: &HistoryEventStream,
    contains: Option<&str>,
    before_id: Option<i64>,
    limit: usize,
    snapshot_len: usize,
) -> Result<(Vec<RawEventRow>, bool)> {
    let stream_predicate = match stream {
        HistoryEventStream::All => {
            " AND (
                thread_name != ?4
                OR CASE
                    WHEN json_valid(event_json) = 0 THEN 1
                    WHEN json_type(event_json, '$.nac_transcript_message.idx') IS NOT 'integer' THEN 1
                    WHEN json_extract(event_json, '$.nac_transcript_message.idx') < 0 THEN 1
                    WHEN json_extract(event_json, '$.nac_transcript_message.idx') >= ?6 THEN 1
                    ELSE 0
                END
            )"
        }
        HistoryEventStream::Orchestrator => {
            " AND thread_name = ?4
              AND CASE
                  WHEN json_valid(event_json) = 0 THEN 1
                  WHEN json_type(event_json, '$.nac_transcript_message.idx') IS NOT 'integer' THEN 1
                  WHEN json_extract(event_json, '$.nac_transcript_message.idx') < 0 THEN 1
                  WHEN json_extract(event_json, '$.nac_transcript_message.idx') >= ?6 THEN 1
                  ELSE 0
              END"
        }
        HistoryEventStream::Thread { .. } => " AND thread_name = ?4 AND ?6 >= 0",
    };
    let sql = format!(
        "WITH candidates AS (
             SELECT id,
                    thread_name,
                    event_json,
                    created_at,
                    CASE
                        WHEN thread_name = ?8
                         AND json_valid(event_json) != 0
                         AND json_type(
                             event_json,
                             '$.nac_transcript_message.message'
                         ) IS 'text'
                        THEN json_extract(
                            event_json,
                            '$.nac_transcript_message.message'
                        )
                        ELSE event_json
                    END AS payload
             FROM thread_events
             WHERE session_id = ?1
               AND (?2 IS NULL OR id < ?2)
         )
         SELECT id,
                thread_name,
                CASE WHEN length(CAST(event_json AS BLOB)) <= ?3
                     THEN event_json
                     ELSE NULL
                END,
                created_at,
                length(payload),
                json_valid(event_json) != 0
         FROM candidates
         WHERE (
               ?7 IS NULL
               OR CASE
                   WHEN thread_name = ?8
                    AND (
                        json_valid(event_json) = 0
                        OR json_type(
                            event_json,
                            '$.nac_transcript_message.message'
                        ) IS NOT 'text'
                    )
                       THEN 1
                   ELSE instr(payload, ?7) > 0
               END
           )
           {stream_predicate}
         ORDER BY id DESC
         LIMIT ?5"
    );
    let stream_name = match stream {
        HistoryEventStream::All | HistoryEventStream::Orchestrator => ORCHESTRATOR_STEERING_TARGET,
        HistoryEventStream::Thread { thread_name } => thread_name.as_str(),
    };
    let mut statement = conn.prepare(&sql)?;
    let rows = statement.query_map(
        params![
            session_id,
            before_id,
            MAX_EVENT_BYTES,
            stream_name,
            i64::try_from(limit.saturating_add(1)).unwrap_or(i64::MAX),
            i64::try_from(snapshot_len).unwrap_or(i64::MAX),
            contains,
            ORCHESTRATOR_STEERING_TARGET,
        ],
        |row| {
            Ok(RawEventRow {
                id: row.get(0)?,
                thread_name: row.get(1)?,
                event_json: row.get(2)?,
                created_at: row.get(3)?,
                payload_chars: row.get(4)?,
                payload_syntax_valid: row.get(5)?,
            })
        },
    )?;
    let mut rows = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    let has_older = rows.len() > limit;
    if has_older {
        rows.truncate(limit);
    }
    Ok((rows, has_older))
}

fn normalize_event_row(
    session_id: &str,
    row: RawEventRow,
    contains: Option<&str>,
) -> Result<HistoryEventRecord> {
    if !row.payload_syntax_valid {
        let kind = if row.thread_name == ORCHESTRATOR_STEERING_TARGET {
            "transcript"
        } else {
            "worker"
        };
        return Err(anyhow!(
            "corrupt_history: thread_events row {} contains syntactically invalid {kind} JSON",
            row.id
        ));
    }
    if row.event_json.is_none() {
        let payload_chars = usize::try_from(row.payload_chars)
            .context("oversized history payload length was negative or overflowed")?;
        let stream = if row.thread_name == ORCHESTRATOR_STEERING_TARGET {
            HistoryEventStreamRef::Orchestrator
        } else {
            HistoryEventStreamRef::Thread {
                thread_name: row.thread_name.clone(),
            }
        };
        return Ok(HistoryEventRecord {
            source: HistoryEventSource::ThreadEvent,
            source_id: row.id,
            session_id: session_id.to_string(),
            stream,
            event_type: "oversized_unparsed_event".to_string(),
            created_at: Some(row.created_at),
            payload_json: String::new(),
            payload_start_char: 0,
            payload_chars,
            payload_truncated: true,
        });
    }
    let event_json = row.event_json.as_deref().expect("checked above");
    if row.thread_name == ORCHESTRATOR_STEERING_TARGET {
        let entry = decode_transcript_log_entry(event_json).ok_or_else(|| {
            anyhow!(
                "corrupt_history: thread_events row {} under '{}' is not a transcript message",
                row.id,
                ORCHESTRATOR_STEERING_TARGET
            )
        })?;
        let message: Message = serde_json::from_str(&entry.message_json).with_context(|| {
            format!(
                "corrupt_history: thread_events row {} contains an invalid transcript message",
                row.id
            )
        })?;
        let record = normalize_message(
            session_id,
            HistoryEventSource::ThreadEvent,
            row.id,
            Some(row.created_at),
            &message,
            contains,
        );
        return Ok(record);
    }

    let event: AgentEvent = serde_json::from_str(event_json).with_context(|| {
        format!(
            "corrupt_history: thread_events row {} contains an invalid worker event",
            row.id
        )
    })?;
    let payload =
        serde_json::to_string(&event).context("failed to serialize stored worker event")?;
    let event_type = serde_json::to_value(&event)
        .ok()
        .and_then(|value| {
            value
                .get("type")
                .and_then(|kind| kind.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "worker_event".to_string());
    let (payload_json, payload_chars, payload_start_char, payload_truncated) =
        bounded_payload(&payload, contains);
    Ok(HistoryEventRecord {
        source: HistoryEventSource::ThreadEvent,
        source_id: row.id,
        session_id: session_id.to_string(),
        stream: HistoryEventStreamRef::Thread {
            thread_name: row.thread_name,
        },
        event_type,
        created_at: Some(row.created_at),
        payload_json,
        payload_start_char,
        payload_chars,
        payload_truncated,
    })
}

fn load_snapshot_page(
    conn: &Connection,
    session_id: &str,
    stream: &HistoryEventStream,
    contains: Option<&str>,
    before_index: Option<usize>,
    limit: usize,
) -> Result<(Vec<HistoryEventRecord>, Option<HistoryEventPhase>)> {
    if !stream_has_snapshot(stream) {
        return Ok((Vec::new(), None));
    }
    let (byte_len, messages_json) = conn
        .query_row(
            "SELECT length(CAST(messages_json AS BLOB)),
                    CASE WHEN length(CAST(messages_json AS BLOB)) <= ?2
                         THEN messages_json ELSE NULL END
             FROM sessions WHERE session_id = ?1",
            params![session_id, MAX_SNAPSHOT_BYTES],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .optional()?
        .with_context(|| format!("session_not_found: session '{session_id}' was not found"))?;
    let messages_json = messages_json.with_context(|| {
        format!(
            "resource_exhausted: session snapshot is {byte_len} bytes (max {MAX_SNAPSHOT_BYTES})"
        )
    })?;
    let messages: Vec<Message> = serde_json::from_str(&messages_json)
        .context("corrupt_history: failed to parse stored session messages")?;
    let end = before_index.unwrap_or(messages.len()).min(messages.len());
    if let Some(needle) = contains {
        let matching = messages[..end]
            .iter()
            .enumerate()
            .filter(|(_, message)| {
                serde_json::to_string(message).is_ok_and(|payload| payload.contains(needle))
            })
            .collect::<Vec<_>>();
        let start = matching.len().saturating_sub(limit);
        let events = matching[start..]
            .iter()
            .map(|(index, message)| {
                normalize_message(
                    session_id,
                    HistoryEventSource::Snapshot,
                    i64::try_from(*index).unwrap_or(i64::MAX),
                    None,
                    message,
                    contains,
                )
            })
            .collect();
        let next = (start > 0).then(|| HistoryEventPhase::Snapshot {
            before_index: matching[start].0,
        });
        return Ok((events, next));
    }
    let start = end.saturating_sub(limit);
    let events = messages[start..end]
        .iter()
        .enumerate()
        .map(|(offset, message)| {
            normalize_message(
                session_id,
                HistoryEventSource::Snapshot,
                i64::try_from(start + offset).unwrap_or(i64::MAX),
                None,
                message,
                None,
            )
        })
        .collect();
    let next = (start > 0).then_some(HistoryEventPhase::Snapshot {
        before_index: start,
    });
    Ok((events, next))
}

fn normalize_message(
    session_id: &str,
    source: HistoryEventSource,
    source_id: i64,
    created_at: Option<String>,
    message: &Message,
    contains: Option<&str>,
) -> HistoryEventRecord {
    let event_type = match &message {
        Message::System { .. } => "system_message",
        Message::User { .. } => "user_message",
        Message::Assistant { .. } => "assistant_message",
        Message::Tool { .. } => "tool_message",
    }
    .to_string();
    let payload = serde_json::to_string(&message).unwrap_or_else(|_| "null".to_string());
    let (payload_json, payload_chars, payload_start_char, payload_truncated) =
        bounded_payload(&payload, contains);
    HistoryEventRecord {
        source,
        source_id,
        session_id: session_id.to_string(),
        stream: HistoryEventStreamRef::Orchestrator,
        event_type,
        created_at,
        payload_json,
        payload_start_char,
        payload_chars,
        payload_truncated,
    }
}

fn bounded_payload(payload: &str, contains: Option<&str>) -> (String, usize, usize, bool) {
    let payload_chars = payload.chars().count();
    let match_start = contains
        .and_then(|needle| payload.find(needle))
        .map(|byte_index| payload[..byte_index].chars().count());
    let payload_start_char = match_start
        .map(|index| index.saturating_sub(MAX_PAYLOAD_CHARS / 4))
        .unwrap_or(0);
    let payload_json = payload
        .chars()
        .skip(payload_start_char)
        .take(MAX_PAYLOAD_CHARS)
        .collect();
    (
        payload_json,
        payload_chars,
        payload_start_char,
        payload_start_char > 0 || payload_chars > MAX_PAYLOAD_CHARS,
    )
}

fn stream_has_snapshot(stream: &HistoryEventStream) -> bool {
    matches!(
        stream,
        HistoryEventStream::All | HistoryEventStream::Orchestrator
    )
}

fn snapshot_message_count(conn: &Connection, session_id: &str) -> Result<usize> {
    let count = conn
        .query_row(
            "SELECT COALESCE(json_array_length(messages_json), 0)
             FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .with_context(|| format!("session_not_found: session '{session_id}' was not found"))?;
    usize::try_from(count).context("stored snapshot message count overflowed")
}

fn thread_stream_exists(conn: &Connection, session_id: &str, thread_name: &str) -> Result<bool> {
    conn.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM thread_events WHERE session_id = ?1 AND thread_name = ?2
             UNION ALL
             SELECT 1 FROM threads WHERE session_id = ?1 AND name = ?2
             UNION ALL
             SELECT 1 FROM episodes WHERE session_id = ?1 AND thread_name = ?2
         )",
        params![session_id, thread_name],
        |row| row.get(0),
    )
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "nac_history_events_{name}_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("store.db")
    }

    fn insert_snapshot(path: &Path, session_id: &str, messages: &[Message]) {
        crate::store::insert_test_session(path, session_id);
        let conn = open_runtime_connection(path).unwrap();
        conn.execute(
            "UPDATE sessions SET messages_json = ?1 WHERE session_id = ?2",
            params![serde_json::to_string(messages).unwrap(), session_id],
        )
        .unwrap();
    }

    #[test]
    fn all_stream_pages_events_then_crosses_to_snapshot_without_duplicates() {
        let path = temp_store("cross_phase");
        crate::store::initialize(&path).unwrap();
        let snapshot = [
            Message::System {
                content: "system".to_string(),
            },
            Message::User {
                content: "legacy user".to_string(),
            },
        ];
        insert_snapshot(&path, "session-a", &snapshot);
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            &encode_transcript_log_entry(0, &snapshot[0]).unwrap(),
        )
        .unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append(
                "session-a",
                2,
                &Message::Assistant {
                    content: Some("recent assistant".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            )
            .unwrap();
        crate::store::append_thread_event(
            &path,
            "session-a",
            "worker-a",
            &serde_json::to_string(&AgentEvent::RunStarted {
                thread_name: Some("worker-a".to_string()),
                prompt_preview: "run started".to_string(),
            })
            .unwrap(),
        )
        .unwrap();

        let recent = load_session_history_events(
            &path,
            "session-a",
            &HistoryEventStream::All,
            None,
            HistoryEventPhase::Events { before_id: None },
            10,
        )
        .unwrap();
        assert_eq!(recent.events.len(), 2);
        assert_eq!(recent.events[0].event_type, "assistant_message");
        assert_eq!(recent.events[1].event_type, "run_started");
        let HistoryEventPhase::Snapshot { before_index } = recent.next_phase.unwrap() else {
            panic!("expected snapshot continuation");
        };
        let legacy = load_session_history_events(
            &path,
            "session-a",
            &HistoryEventStream::All,
            None,
            HistoryEventPhase::Snapshot { before_index },
            10,
        )
        .unwrap();
        assert_eq!(
            legacy
                .events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<_>>(),
            ["system_message", "user_message"]
        );
        assert!(legacy.next_phase.is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn thread_stream_exposes_event_only_failed_work() {
        let path = temp_store("event_only");
        crate::store::initialize(&path).unwrap();
        insert_snapshot(&path, "session-a", &[]);
        crate::store::append_thread_event(
            &path,
            "session-a",
            "failed-worker",
            &serde_json::to_string(&AgentEvent::Error {
                thread_name: Some("failed-worker".to_string()),
                message: "build failed".to_string(),
            })
            .unwrap(),
        )
        .unwrap();
        let page = load_session_history_events(
            &path,
            "session-a",
            &HistoryEventStream::Thread {
                thread_name: "failed-worker".to_string(),
            },
            None,
            HistoryEventPhase::Events { before_id: None },
            10,
        )
        .unwrap();
        assert_eq!(page.events.len(), 1);
        assert_eq!(page.events[0].event_type, "error");
        assert!(page.events[0].payload_json.contains("build failed"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn literal_filter_pages_matching_events_and_snapshot_to_exhaustion() {
        let path = temp_store("literal_filter");
        crate::store::initialize(&path).unwrap();
        insert_snapshot(
            &path,
            "session-a",
            &[
                Message::System {
                    content: "unrelated".to_string(),
                },
                Message::User {
                    content: "cancelled snapshot".to_string(),
                },
            ],
        );
        for message in ["old cancelled event", "unrelated", "new cancelled event"] {
            crate::store::append_thread_event(
                &path,
                "session-a",
                "worker-a",
                &serde_json::to_string(&AgentEvent::Error {
                    thread_name: Some("worker-a".to_string()),
                    message: message.to_string(),
                })
                .unwrap(),
            )
            .unwrap();
        }

        let mut phase = HistoryEventPhase::Events { before_id: None };
        let mut payloads = Vec::new();
        for _ in 0..4 {
            let page = load_session_history_events(
                &path,
                "session-a",
                &HistoryEventStream::All,
                Some("cancelled"),
                phase,
                1,
            )
            .unwrap();
            payloads.extend(page.events.into_iter().map(|event| event.payload_json));
            let Some(next) = page.next_phase else {
                break;
            };
            phase = next;
        }
        assert_eq!(payloads.len(), 3);
        assert!(payloads[0].contains("new cancelled event"));
        assert!(payloads[1].contains("old cancelled event"));
        assert!(payloads[2].contains("cancelled snapshot"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn literal_filter_matches_visible_orchestrator_payload_not_envelope() {
        let path = temp_store("literal_filter_orchestrator");
        crate::store::initialize(&path).unwrap();
        insert_snapshot(
            &path,
            "session-a",
            &[Message::User {
                content: "message in snapshot payload".to_string(),
            }],
        );
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            &encode_transcript_log_entry(
                1,
                &Message::Assistant {
                    content: Some("ordinary tail payload".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            )
            .unwrap(),
        )
        .unwrap();

        let recent = load_session_history_events(
            &path,
            "session-a",
            &HistoryEventStream::Orchestrator,
            Some("message"),
            HistoryEventPhase::Events { before_id: None },
            10,
        )
        .unwrap();
        assert_eq!(recent.events.len(), 1);
        assert_eq!(recent.events[0].source, HistoryEventSource::Snapshot);
        assert!(recent.events[0]
            .payload_json
            .contains("message in snapshot payload"));
        assert!(recent.next_phase.is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
    #[test]
    fn filtered_payload_excerpt_includes_a_match_beyond_the_prefix() {
        let payload = format!("{}cancelled near the tail", "x".repeat(1_500));
        let (excerpt, chars, start, truncated) = bounded_payload(&payload, Some("cancelled"));
        assert!(excerpt.contains("cancelled near the tail"));
        assert_eq!(chars, payload.chars().count());
        assert!(start > 0);
        assert!(truncated);
    }

    #[test]
    fn oversized_worker_event_returns_marker_and_preserves_pagination() {
        let path = temp_store("oversized_worker_event");
        crate::store::initialize(&path).unwrap();
        insert_snapshot(&path, "session-a", &[]);
        let thread_name = "worker-a";
        for message in [
            "needle in older event".to_string(),
            format!(
                "{}needle in oversized event",
                "x".repeat(MAX_EVENT_BYTES as usize)
            ),
            "newest event".to_string(),
        ] {
            crate::store::append_thread_event(
                &path,
                "session-a",
                thread_name,
                &serde_json::to_string(&AgentEvent::Error {
                    thread_name: Some(thread_name.to_string()),
                    message,
                })
                .unwrap(),
            )
            .unwrap();
        }
        let stream = HistoryEventStream::Thread {
            thread_name: thread_name.to_string(),
        };

        let newest = load_session_history_events(
            &path,
            "session-a",
            &stream,
            None,
            HistoryEventPhase::Events { before_id: None },
            1,
        )
        .unwrap();
        assert_eq!(newest.events[0].event_type, "error");
        let oversized = load_session_history_events(
            &path,
            "session-a",
            &stream,
            None,
            newest.next_phase.unwrap(),
            1,
        )
        .unwrap();
        assert_eq!(oversized.events[0].event_type, "oversized_unparsed_event");
        assert!(oversized.events[0].payload_json.is_empty());
        assert!(oversized.events[0].payload_truncated);
        let older = load_session_history_events(
            &path,
            "session-a",
            &stream,
            None,
            oversized.next_phase.unwrap(),
            1,
        )
        .unwrap();
        assert!(older.events[0]
            .payload_json
            .contains("needle in older event"));
        assert!(older.next_phase.is_none());

        let filtered = load_session_history_events(
            &path,
            "session-a",
            &stream,
            Some("needle"),
            HistoryEventPhase::Events { before_id: None },
            1,
        )
        .unwrap();
        assert_eq!(filtered.events[0].event_type, "oversized_unparsed_event");
        assert!(filtered.events[0].payload_json.is_empty());
        let filtered_older = load_session_history_events(
            &path,
            "session-a",
            &stream,
            Some("needle"),
            filtered.next_phase.unwrap(),
            1,
        )
        .unwrap();
        assert!(filtered_older.events[0]
            .payload_json
            .contains("needle in older event"));
        assert!(filtered_older.next_phase.is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn oversized_orchestrator_marker_uses_canonical_payload_length() {
        let path = temp_store("oversized_orchestrator_event");
        crate::store::initialize(&path).unwrap();
        insert_snapshot(&path, "session-a", &[]);
        let message = Message::Assistant {
            content: Some(format!("{}tail", "x".repeat(MAX_EVENT_BYTES as usize))),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        };
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            &encode_transcript_log_entry(0, &message).unwrap(),
        )
        .unwrap();

        let page = load_session_history_events(
            &path,
            "session-a",
            &HistoryEventStream::Orchestrator,
            Some("\"content\""),
            HistoryEventPhase::Events { before_id: None },
            10,
        )
        .unwrap();
        assert_eq!(page.events.len(), 1);
        let event = &page.events[0];
        assert_eq!(event.event_type, "oversized_unparsed_event");
        assert!(event.payload_json.is_empty());
        assert_eq!(
            event.payload_chars,
            serde_json::to_string(&message).unwrap().chars().count()
        );
        assert!(event.payload_truncated);
        assert!(page.next_phase.is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn oversized_structurally_unvalidated_rows_return_explicit_markers() {
        let path = temp_store("oversized_structurally_invalid");
        crate::store::initialize(&path).unwrap();
        let padding = "x".repeat(MAX_EVENT_BYTES as usize);
        for session_id in ["worker-session", "orchestrator-session"] {
            insert_snapshot(&path, session_id, &[]);
        }
        crate::store::append_thread_event(
            &path,
            "worker-session",
            "worker-a",
            &serde_json::json!({
                "type": "error",
                "padding": padding
            })
            .to_string(),
        )
        .unwrap();
        let invalid_message = serde_json::json!({
            "unexpected": "x".repeat(MAX_EVENT_BYTES as usize)
        })
        .to_string();
        crate::store::append_thread_event(
            &path,
            "orchestrator-session",
            ORCHESTRATOR_STEERING_TARGET,
            &serde_json::json!({
                "nac_transcript_message": {
                    "idx": 0,
                    "kind": "user",
                    "message": invalid_message
                }
            })
            .to_string(),
        )
        .unwrap();

        for (session_id, stream) in [
            (
                "worker-session",
                HistoryEventStream::Thread {
                    thread_name: "worker-a".to_string(),
                },
            ),
            ("orchestrator-session", HistoryEventStream::Orchestrator),
        ] {
            let page = load_session_history_events(
                &path,
                session_id,
                &stream,
                None,
                HistoryEventPhase::Events { before_id: None },
                10,
            )
            .unwrap();
            assert_eq!(page.events.len(), 1);
            assert_eq!(page.events[0].event_type, "oversized_unparsed_event");
            assert!(page.events[0].payload_json.is_empty());
        }
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn oversized_malformed_reserved_row_remains_corrupt_history() {
        let path = temp_store("oversized_malformed_reserved");
        crate::store::initialize(&path).unwrap();
        insert_snapshot(&path, "session-a", &[]);
        let malformed = format!("{{\"payload\":\"{}", "x".repeat(MAX_EVENT_BYTES as usize));
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            &malformed,
        )
        .unwrap();

        let error = load_session_history_events(
            &path,
            "session-a",
            &HistoryEventStream::Orchestrator,
            Some("not present"),
            HistoryEventPhase::Events { before_id: None },
            10,
        )
        .unwrap_err();
        assert!(format!("{error:#}").contains("corrupt_history"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn malformed_reserved_rows_are_not_hidden_by_snapshot_filtering() {
        let path = temp_store("malformed_reserved");
        crate::store::initialize(&path).unwrap();
        for (session_id, event_json) in [
            ("missing-index", "{}"),
            ("syntactically-invalid", "{malformed"),
        ] {
            insert_snapshot(
                &path,
                session_id,
                &[Message::System {
                    content: "snapshot".to_string(),
                }],
            );
            crate::store::append_thread_event(
                &path,
                session_id,
                ORCHESTRATOR_STEERING_TARGET,
                event_json,
            )
            .unwrap();
            let error = load_session_history_events(
                &path,
                session_id,
                &HistoryEventStream::All,
                None,
                HistoryEventPhase::Events { before_id: None },
                10,
            )
            .unwrap_err();
            assert!(format!("{error:#}").contains("corrupt_history"));
        }
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
