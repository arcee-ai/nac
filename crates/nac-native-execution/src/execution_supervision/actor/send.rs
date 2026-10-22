//! Complete logical groups. Cancellation of any physical send denies the pair.
use super::super::{
    job_wire::{Frame, Stream, MAX_FRAGMENT},
    wire_pump::WireSender,
};
use anyhow::Result;
use std::time::Instant;
use uuid::Uuid;

pub(super) async fn command(
    wire: &WireSender,
    job: Uuid,
    data: &[u8],
    deadline: Instant,
) -> Result<()> {
    for (index, fragment) in data.chunks(MAX_FRAGMENT).enumerate() {
        wire.send(
            Frame::CommandFragment {
                job_id: job,
                offset: (index * MAX_FRAGMENT).try_into()?,
                data: fragment.to_vec(),
            },
            deadline,
        )
        .await?;
    }
    Ok(())
}
pub(super) async fn data(
    wire: &WireSender,
    job: Uuid,
    stream: Stream,
    block: u64,
    data: &[u8],
    deadline: Instant,
) -> Result<()> {
    wire.send(
        Frame::BeginData {
            job_id: job,
            stream,
            block,
            bytes: data.len().try_into()?,
        },
        deadline,
    )
    .await?;
    for (index, fragment) in data.chunks(MAX_FRAGMENT).enumerate() {
        wire.send(
            Frame::DataFragment {
                job_id: job,
                stream,
                block,
                offset: (index * MAX_FRAGMENT).try_into()?,
                data: fragment.to_vec(),
            },
            deadline,
        )
        .await?;
    }
    wire.send(
        Frame::EndData {
            job_id: job,
            stream,
            block,
        },
        deadline,
    )
    .await
}

pub(super) struct JobIds {
    prefix: u64,
    next: u64,
}
pub(super) struct IncomingIds {
    prefix: Option<u64>,
    next: u64,
}
impl JobIds {
    pub(super) fn new() -> Self {
        Self {
            prefix: (Uuid::new_v4().as_u128() >> 64) as u64,
            next: 1,
        }
    }
    pub(super) fn take(&mut self) -> Result<Uuid> {
        let next = self
            .next
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("Native job sequence exhausted"))?;
        let job = Uuid::from_u128((u128::from(self.prefix) << 64) | u128::from(self.next));
        self.next = next;
        Ok(job)
    }
}
impl IncomingIds {
    pub(super) fn new() -> Self {
        Self {
            prefix: None,
            next: 1,
        }
    }
    pub(super) fn accept(&mut self, job: Uuid) -> Result<()> {
        let prefix = (job.as_u128() >> 64) as u64;
        anyhow::ensure!(
            self.prefix.is_none_or(|value| value == prefix) && job.as_u128() as u64 == self.next,
            "Native command identity is replayed or out of order"
        );
        self.next = self
            .next
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("Native job sequence exhausted"))?;
        self.prefix = Some(prefix);
        Ok(())
    }
}
