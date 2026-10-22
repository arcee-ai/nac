//! Storage for original guidance bytes; no process receipt or effect permit.
use super::super::protected_execution_resources::CaptureReservation;
use super::*;
use anyhow::ensure;

pub(in crate::runtime) struct GuidanceCapture {
    reservation: CaptureReservation,
    limit: usize,
}
pub(in crate::runtime) struct GuidanceBytes {
    bytes: Vec<u8>,
    _reservation: CaptureReservation,
}
impl GuidanceBytes {
    pub(in crate::runtime) fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}
impl GuidanceCapture {
    pub(in crate::runtime) fn finish(self, bytes: Vec<u8>) -> Result<GuidanceBytes> {
        ensure!(
            bytes.capacity() <= self.limit,
            "guidance capture exceeds original reservation"
        );
        Ok(GuidanceBytes {
            bytes,
            _reservation: self.reservation,
        })
    }
}
impl ProtectedExecutionContext {
    /// Reserve against the actual original boundary's shared session before
    /// guidance allocation. This issues no execution permit and no fake exit.
    pub(in crate::runtime) fn reserve_guidance_capture(
        &self,
        bytes: usize,
    ) -> Result<GuidanceCapture> {
        self.check_stage(ProtectedExecutionStage::Prepare)?;
        let reservation = self.state()?.admission.capture(bytes, 0)?;
        Ok(GuidanceCapture {
            reservation,
            limit: bytes,
        })
    }
}
