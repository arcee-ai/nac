use super::*;
use std::path::PathBuf;

use crate::store;

use crate::types::Message;

fn user(content: &str) -> Message {
    Message::User {
        content: content.to_string(),
    }
}

struct StoreFixture {
    root: PathBuf,
    path: PathBuf,
}

impl StoreFixture {
    fn new(label: &str) -> Self {
        let path = crate::test_utils::temp_store_path(label);
        store::initialize(&path).unwrap();
        store::insert_test_session(&path, "session");
        Self {
            root: path.parent().unwrap().to_path_buf(),
            path,
        }
    }
}

impl Drop for StoreFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
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
