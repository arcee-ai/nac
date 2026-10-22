//! One bounded, sticky-failed logical message. The actor owns job/state quotas.
use super::{Stream, MAX_DATA, MAX_ENCODED_COMMAND, MAX_FRAGMENT};
use anyhow::{bail, ensure, Result};
use uuid::Uuid;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in super::super) enum AssemblyId {
    Command(Uuid),
    Data {
        job_id: Uuid,
        stream: Stream,
        block: u64,
    },
}

pub(in super::super) struct Assembly {
    id: AssemblyId,
    expected: usize,
    raw: Vec<u8>,
    failed: bool,
}

impl Assembly {
    pub(in super::super) fn new(id: AssemblyId, expected: usize) -> Result<Self> {
        let (job_id, limit) = match id {
            AssemblyId::Command(job) => (job, MAX_ENCODED_COMMAND),
            AssemblyId::Data { job_id, .. } => (job_id, MAX_DATA),
        };
        ensure!(
            !job_id.is_nil() && (1..=limit).contains(&expected),
            "invalid assembly"
        );
        let mut raw = Vec::new();
        raw.try_reserve_exact(expected)?;
        Ok(Self {
            id,
            expected,
            raw,
            failed: false,
        })
    }

    pub(in super::super) fn push(
        &mut self,
        id: AssemblyId,
        offset: usize,
        data: &[u8],
    ) -> Result<()> {
        if self.failed
            || self.id != id
            || offset != self.raw.len()
            || data.is_empty()
            || data.len() > MAX_FRAGMENT
            || offset
                .checked_add(data.len())
                .is_none_or(|end| end > self.expected)
        {
            self.failed = true;
            self.raw.clear();
            bail!("job assembly mismatch");
        }
        self.raw.extend_from_slice(data);
        Ok(())
    }

    pub(in super::super) fn finish(self, id: AssemblyId) -> Result<Vec<u8>> {
        ensure!(
            !self.failed && self.id == id && self.raw.len() == self.expected,
            "incomplete job assembly"
        );
        Ok(self.raw)
    }
}
