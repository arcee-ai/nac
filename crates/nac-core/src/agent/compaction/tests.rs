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
        model_origin: None,
        reasoning_field: None,
    }
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
