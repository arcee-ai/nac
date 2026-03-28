use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

#[allow(dead_code)]
pub struct Session {
    pub container_name: String,
    pub workspace_path: PathBuf,
    pub image: String,
    pub repo_url: Option<String>,
    pub created_at: Instant,
}

pub type SessionStore = Arc<Mutex<HashMap<String, Session>>>;

pub fn new_store() -> SessionStore {
    Arc::new(Mutex::new(HashMap::new()))
}
