//! Whether a human client is attached to the process serving one store.
//!
//! A connected app can surface a pending approval (the Inbox lists it), and its
//! human answers by opening the owning session. Presence is only the "there is
//! an approver to wait for" signal: it never answers, grants or reviews
//! anything, and with no client attached an Ask still fails closed.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

fn counts() -> &'static Mutex<HashMap<PathBuf, usize>> {
    static COUNTS: OnceLock<Mutex<HashMap<PathBuf, usize>>> = OnceLock::new();
    COUNTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The same store reached through another spelling (a symlink, `..`) counts
/// once its canonical form matches.
fn key(store_path: &Path) -> PathBuf {
    std::fs::canonicalize(store_path).unwrap_or_else(|_| store_path.to_path_buf())
}

/// Held for the lifetime of one live client connection (a session event
/// stream or the fleet attention stream). Dropping it ends that presence.
#[derive(Debug)]
#[must_use = "presence lasts only while the guard is held"]
pub struct InteractivePresence {
    key: PathBuf,
}

impl InteractivePresence {
    pub fn enter(store_path: &Path) -> Self {
        let key = key(store_path);
        *counts()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .entry(key.clone())
            .or_default() += 1;
        Self { key }
    }

    /// True while any client holds presence for this store.
    pub fn connected(store_path: &Path) -> bool {
        let counts = counts()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if counts.is_empty() {
            return false;
        }
        counts.contains_key(store_path) || counts.contains_key(&key(store_path))
    }
}

impl Drop for InteractivePresence {
    fn drop(&mut self) {
        let mut counts = counts()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(count) = counts.get_mut(&self.key) {
            *count -= 1;
            if *count == 0 {
                counts.remove(&self.key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presence_is_scoped_to_one_store_and_ends_with_its_last_guard() {
        let root = std::env::temp_dir().join(format!("nac-presence-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let store = root.join("presence.db");
        let other = root.join("other.db");
        std::fs::write(&store, b"").unwrap();
        assert!(!InteractivePresence::connected(&store));
        let first = InteractivePresence::enter(&store);
        let second = InteractivePresence::enter(&root.join(".").join("presence.db"));
        assert!(InteractivePresence::connected(&store));
        assert!(!InteractivePresence::connected(&other));
        drop(first);
        assert!(InteractivePresence::connected(&store));
        drop(second);
        assert!(!InteractivePresence::connected(&store));
        std::fs::remove_dir_all(root).unwrap();
    }
}
