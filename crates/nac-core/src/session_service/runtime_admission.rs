use super::*;

impl SessionService {
    /// A required agent's retained lease governs its admitted original run;
    /// possession of that handle never authorizes a different prompt, inbox
    /// item, compaction or autonomous successor. The qualified ingress producer
    /// must separately bind fresh admission to the durable operation barrier.
    /// Until that producer is installed, conventional paths fail before state
    /// recovery, input mutation or run publication, even with a live old lease.
    pub(super) fn check_conventional_runtime_admission(&self) -> Result<()> {
        if self.runtime_effect_required {
            anyhow::bail!("authenticated runtime operation admission required");
        }
        self.check_host_execution_authority()
    }
}

#[cfg(test)]
mod tests;
