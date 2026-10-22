//! Native execution transport adapter. Raw I/O is never qualification.
#[cfg(unix)]
mod execution_supervision;
#[cfg(unix)]
pub use execution_supervision::{ExecutionPeerExpectation, ExecutionSupervisionChannel};

#[cfg(target_os = "linux")]
pub use execution_supervision::{
    NativeCreateFailure, NativeCreateJoin, NativeCreateLaunch, NativeCreateResources,
};

/// Fixed internal child entry; accepts no authority or caller-selected runner.
/// Actual original-parent kernel capture is mandatory before dispatch exists.
#[cfg(target_os = "linux")]
#[doc(hidden)]
pub async fn run_original_native_child() -> anyhow::Result<()> {
    execution_supervision::run_original_native_child().await
}
