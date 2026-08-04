use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A slice of model output as the provider emits it. Both fields are additive:
/// each delta carries only what arrived since the previous one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelStreamDelta {
    pub text: String,
    pub reasoning: String,
}

impl ModelStreamDelta {
    pub fn text(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            reasoning: String::new(),
        }
    }

    pub fn reasoning(reasoning: impl Into<String>) -> Self {
        Self {
            text: String::new(),
            reasoning: reasoning.into(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty() && self.reasoning.is_empty()
    }

    fn absorb(&mut self, other: &Self) {
        self.text.push_str(&other.text);
        self.reasoning.push_str(&other.reasoning);
    }
}

/// Receives model output while the call is still in flight. `None` means nobody
/// is watching, which keeps the plain non-streaming request shape in play.
pub type DeltaSink<'a> = Option<&'a (dyn Fn(ModelStreamDelta) + Send + Sync)>;

/// How often batched deltas reach their destination. Below roughly this rate the
/// text is already arriving faster than the eye follows, and every event costs a
/// broadcast plus a React render.
const FLUSH_INTERVAL: Duration = Duration::from_millis(100);

/// Batches deltas so a fast provider cannot turn every token into an event.
///
/// The first delta of a call goes out immediately — that one carries the signal
/// that the model started answering, and the wait for it is the wait the user
/// actually notices.
pub struct CoalescedDeltas<F> {
    forward: F,
    state: Mutex<CoalescerState>,
}

struct CoalescerState {
    pending: ModelStreamDelta,
    last_flush: Option<Instant>,
}

impl<F: Fn(ModelStreamDelta)> CoalescedDeltas<F> {
    pub fn new(forward: F) -> Self {
        Self {
            forward,
            state: Mutex::new(CoalescerState {
                pending: ModelStreamDelta::default(),
                last_flush: None,
            }),
        }
    }

    pub fn push(&self, delta: ModelStreamDelta) {
        let due = {
            let mut state = self.state.lock().expect("delta coalescer state");
            state.pending.absorb(&delta);
            let due = state
                .last_flush
                .is_none_or(|last| last.elapsed() >= FLUSH_INTERVAL);
            if due {
                state.last_flush = Some(Instant::now());
                Some(std::mem::take(&mut state.pending))
            } else {
                None
            }
        };
        if let Some(delta) = due {
            self.emit(delta);
        }
    }

    /// Hand over whatever is still buffered. Called when the call ends, so the
    /// visible text is complete even if the last tokens landed mid-interval.
    pub fn flush(&self) {
        let pending = {
            let mut state = self.state.lock().expect("delta coalescer state");
            std::mem::take(&mut state.pending)
        };
        self.emit(pending);
    }

    fn emit(&self, delta: ModelStreamDelta) {
        if !delta.is_empty() {
            (self.forward)(delta);
        }
    }
}