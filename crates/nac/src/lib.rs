#[cfg(test)]
use std::sync::Mutex;

mod agent;
mod agents_md;
mod cli;
mod events;
mod mcp;
mod model;
mod paths;
mod process;
mod sandbox;
mod sessions;
mod skills;
mod store;
mod terminal;
mod tools;
mod tui;
mod types;

pub use cli::run;

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());
