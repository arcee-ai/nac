//! Private Native client/runner construction; never a Core authority factory.
#[cfg(all(test, target_os = "linux"))]
mod aggregate_tests;
mod byte_queue;
mod capture;
#[cfg(target_os = "linux")]
mod child;
mod client;
mod client_job;
mod client_ports;
mod client_send;
mod construction;
mod flow;
#[cfg(target_os = "linux")]
mod issuer_process;
#[cfg(target_os = "linux")]
pub use issuer_process::{
    NativeCreateFailure, NativeCreateJoin, NativeCreateLaunch, NativeCreateResources,
};
mod issuer_child_storage;
pub(super) mod resources;
#[cfg(target_os = "linux")]
mod runner;
#[cfg(target_os = "linux")]
#[path = "runner_entry.rs"]
mod runner_entry;
#[cfg(target_os = "linux")]
mod runner_job;
#[cfg(target_os = "linux")]
pub(crate) async fn run_original_native_child() -> anyhow::Result<()> {
    runner_entry::run().await
}
mod send;
mod stop;
#[cfg(all(test, target_os = "linux"))]
mod tests;
