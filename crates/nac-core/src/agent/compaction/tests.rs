use super::*;
use std::path::PathBuf;

use crate::types::Message;

fn user(content: &str) -> Message {
    Message::User {
        content: content.to_string(),
    }
}

fn assistant(content: &str) -> Message {
    Message::Assistant {
        content: Some(content.to_string()),
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
    }
}

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_agent_compaction_{label}_{unique}"))
        .join("store.db")
}

fn state(path: PathBuf, threshold: Option<u64>) -> CompactionState {
    CompactionState::new(path, "session".to_string(), threshold)
}

fn candidate(plan: CompactionPlan) -> CompactionCandidate {
    match plan.decision {
        CompactionDecision::Candidate(candidate) => candidate,
        decision => panic!("expected candidate, got {decision:?}"),
    }
}

mod accounting;
mod checkpoints;
mod planning;
mod policy;
