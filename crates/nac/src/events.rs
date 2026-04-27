use serde::{Deserialize, Serialize};
use tokio::sync::mpsc::UnboundedSender;

pub const STDERR_EVENT_PREFIX: &str = "__NAC_EVENT__";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    RunStarted {
        thread_name: Option<String>,
        prompt_preview: String,
    },
    ModelCallStarted {
        thread_name: Option<String>,
        iteration: usize,
    },
    ToolCallStarted {
        thread_name: Option<String>,
        call_id: String,
        name: String,
        args_preview: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        args_detail: Option<String>,
    },
    ToolCallFinished {
        thread_name: Option<String>,
        call_id: String,
        name: String,
        content_preview: String,
        is_error: bool,
    },
    ThreadStarted {
        name: String,
        action: String,
        source_threads: Vec<String>,
    },
    ThreadLog {
        name: String,
        line: String,
    },
    ThreadFinished {
        name: String,
        exit_code: i32,
        timed_out: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout_reason: Option<String>,
    },
    AssistantMessage {
        thread_name: Option<String>,
        content: String,
    },
    Error {
        thread_name: Option<String>,
        message: String,
    },
    RunFinished {
        thread_name: Option<String>,
    },
}

#[derive(Clone, Default)]
pub struct EventSink {
    channel: Option<UnboundedSender<AgentEvent>>,
    stderr_prefixed: bool,
}

impl EventSink {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn channel(channel: UnboundedSender<AgentEvent>) -> Self {
        Self {
            channel: Some(channel),
            stderr_prefixed: false,
        }
    }

    pub fn stderr_prefixed() -> Self {
        Self {
            channel: None,
            stderr_prefixed: true,
        }
    }

    pub fn emit(&self, event: AgentEvent) {
        if self.stderr_prefixed {
            if let Ok(encoded) = serde_json::to_string(&event) {
                eprintln!("{}{}", STDERR_EVENT_PREFIX, encoded);
            }
        }

        if let Some(channel) = &self.channel {
            let _ = channel.send(event);
        }
    }
}

pub fn decode_stderr_event(line: &str) -> Option<AgentEvent> {
    let encoded = line.strip_prefix(STDERR_EVENT_PREFIX)?;
    serde_json::from_str(encoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_prefixed_event_round_trip() {
        let event = AgentEvent::ThreadStarted {
            name: "impl".to_string(),
            action: "inspect auth".to_string(),
            source_threads: vec!["auth".to_string()],
        };
        let encoded = format!(
            "{}{}",
            STDERR_EVENT_PREFIX,
            serde_json::to_string(&event).unwrap()
        );

        let decoded = decode_stderr_event(&encoded).unwrap();
        assert_eq!(decoded, event);
    }

    #[test]
    fn decode_prefixed_event_ignores_plain_lines() {
        assert!(decode_stderr_event("plain stderr line").is_none());
    }
}
