//! The agent's transcript with a generation that changes whenever a message
//! already in it may have changed. Appending keeps the generation, so work
//! derived from a stable prefix (compaction checkpoint validation) is reused
//! across turns instead of re-serializing and re-hashing history each time.
use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::types::Message;

static NEXT_GENERATION: AtomicU64 = AtomicU64::new(1);

fn next_generation() -> u64 {
    NEXT_GENERATION.fetch_add(1, Ordering::Relaxed)
}

/// Generations are unique within the process, so one also names a single
/// transcript instance: a replaced or cloned transcript never shares it.
#[derive(Debug)]
pub struct TranscriptMessages {
    messages: Vec<Message>,
    generation: u64,
}

impl TranscriptMessages {
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Append without touching any message already present.
    pub fn push(&mut self, message: Message) {
        self.messages.push(message);
    }

    /// Append without touching any message already present.
    pub fn extend(&mut self, messages: impl IntoIterator<Item = Message>) {
        self.messages.extend(messages);
    }
}

impl Default for TranscriptMessages {
    fn default() -> Self {
        Vec::new().into()
    }
}

impl Clone for TranscriptMessages {
    fn clone(&self) -> Self {
        self.messages.clone().into()
    }
}

impl From<Vec<Message>> for TranscriptMessages {
    fn from(messages: Vec<Message>) -> Self {
        Self {
            messages,
            generation: next_generation(),
        }
    }
}

impl FromIterator<Message> for TranscriptMessages {
    fn from_iter<I: IntoIterator<Item = Message>>(messages: I) -> Self {
        messages.into_iter().collect::<Vec<_>>().into()
    }
}

impl From<TranscriptMessages> for Vec<Message> {
    fn from(transcript: TranscriptMessages) -> Self {
        transcript.messages
    }
}

impl serde::Serialize for TranscriptMessages {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.messages.serialize(serializer)
    }
}

impl Deref for TranscriptMessages {
    type Target = Vec<Message>;

    fn deref(&self) -> &Vec<Message> {
        &self.messages
    }
}

/// Any other mutable access may rewrite history, so it starts a generation.
impl DerefMut for TranscriptMessages {
    fn deref_mut(&mut self) -> &mut Vec<Message> {
        self.generation = next_generation();
        &mut self.messages
    }
}

#[cfg(test)]
#[path = "transcript_messages_tests.rs"]
mod tests;
