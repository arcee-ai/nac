use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

pub const DEFAULT_COMMAND_OUTPUT_MAX_BYTES: usize = 8 * 1024 * 1024;
pub const DEFAULT_COMMAND_OUTPUT_SESSION_MAX_BYTES: usize = 64 * 1024 * 1024;
pub const DEFAULT_OUTPUT_PAGE_BYTES: usize = 16 * 1024;
pub const MAX_OUTPUT_PAGE_BYTES: usize = 64 * 1024;
const OUTPUT_CHUNK_COALESCE_BYTES: usize = 32 * 1024;
const MAX_RETAINED_CHUNKS_PER_ARTIFACT: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandOutputLimits {
    pub per_command_bytes: usize,
    pub per_session_bytes: usize,
}

impl Default for CommandOutputLimits {
    fn default() -> Self {
        Self {
            per_command_bytes: DEFAULT_COMMAND_OUTPUT_MAX_BYTES,
            per_session_bytes: DEFAULT_COMMAND_OUTPUT_SESSION_MAX_BYTES,
        }
    }
}

impl CommandOutputLimits {
    pub fn validate(self) -> Result<Self> {
        if self.per_command_bytes == 0 {
            return Err(anyhow!(
                "worker.command_output_max_bytes must be at least 1"
            ));
        }
        if self.per_command_bytes > 1024 * 1024 * 1024 {
            return Err(anyhow!(
                "worker.command_output_max_bytes must not exceed 1073741824"
            ));
        }
        if self.per_session_bytes < self.per_command_bytes {
            return Err(anyhow!(
                "worker.command_output_session_max_bytes must be at least worker.command_output_max_bytes"
            ));
        }
        if self.per_session_bytes > 4usize * 1024 * 1024 * 1024 {
            return Err(anyhow!(
                "worker.command_output_session_max_bytes must not exceed 4294967296"
            ));
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OutputStream {
    Combined,
    Stdout,
    Stderr,
}

impl OutputStream {
    pub fn parse(value: Option<&str>) -> Result<Self> {
        match value.unwrap_or("combined") {
            "combined" => Ok(Self::Combined),
            "stdout" => Ok(Self::Stdout),
            "stderr" => Ok(Self::Stderr),
            other => Err(anyhow!(
                "invalid stream '{other}'; expected combined, stdout, or stderr"
            )),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactKind {
    Command,
    Pty,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutputSegment {
    pub sequence: u64,
    pub stream: OutputStream,
    pub combined_start: u64,
    pub combined_end: u64,
    pub stream_start: u64,
    pub stream_end: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutputPage {
    pub output_id: String,
    pub stream: OutputStream,
    pub offset: u64,
    pub content: String,
    pub next_offset: u64,
    pub eof: bool,
    pub overflowed: bool,
    pub retained_start: u64,
    pub retained_end: u64,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub segments: Vec<OutputSegment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArtifactStats {
    pub stdout_bytes: u64,
    pub stderr_bytes: u64,
    pub combined_bytes: u64,
    pub retained_bytes: usize,
    pub overflowed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OutputPreview {
    pub(crate) start_offset: u64,
    pub(crate) end_offset: u64,
    pub(crate) content: String,
    pub(crate) truncated: bool,
    pub(crate) overflowed: bool,
}

#[derive(Clone)]
pub struct OutputRegistry {
    inner: Arc<Mutex<RegistryInner>>,
    limits: CommandOutputLimits,
}

struct RegistryInner {
    artifacts: HashMap<String, Artifact>,
    retained_bytes: usize,
    next_sequence: u64,
}

struct Artifact {
    kind: ArtifactKind,
    chunks: VecDeque<OutputChunk>,
    stdout_bytes: u64,
    stderr_bytes: u64,
    combined_bytes: u64,
    retained_bytes: usize,
    overflowed: bool,
}

struct OutputChunk {
    sequence: u64,
    stream: OutputStream,
    stream_start: u64,
    combined_start: u64,
    bytes: Vec<u8>,
    consumed: usize,
}

impl OutputChunk {
    fn retained(&self) -> &[u8] {
        &self.bytes[self.consumed..]
    }

    fn retained_len(&self) -> usize {
        self.bytes.len().saturating_sub(self.consumed)
    }

    fn retained_stream_start(&self) -> u64 {
        self.stream_start + self.consumed as u64
    }

    fn retained_combined_start(&self) -> u64 {
        self.combined_start + self.consumed as u64
    }
}

static NEXT_OUTPUT_ID: AtomicU64 = AtomicU64::new(1);

impl OutputRegistry {
    pub fn new(limits: CommandOutputLimits) -> Result<Self> {
        let limits = limits.validate()?;
        Ok(Self {
            inner: Arc::new(Mutex::new(RegistryInner {
                artifacts: HashMap::new(),
                retained_bytes: 0,
                next_sequence: 1,
            })),
            limits,
        })
    }

    pub fn create(&self, kind: ArtifactKind) -> String {
        let number = NEXT_OUTPUT_ID.fetch_add(1, Ordering::Relaxed);
        let prefix = match kind {
            ArtifactKind::Command => "cmdout",
            ArtifactKind::Pty => "termout",
        };
        let output_id = format!("{prefix}-{number}");
        let artifact = Artifact {
            kind,
            chunks: VecDeque::new(),
            stdout_bytes: 0,
            stderr_bytes: 0,
            combined_bytes: 0,
            retained_bytes: 0,
            overflowed: false,
        };
        self.inner
            .lock()
            .expect("command output registry poisoned")
            .artifacts
            .insert(output_id.clone(), artifact);
        output_id
    }

    pub fn append(&self, output_id: &str, stream: OutputStream, mut bytes: Vec<u8>) -> Result<()> {
        if bytes.is_empty() {
            return Ok(());
        }
        if stream == OutputStream::Combined {
            let inner = self.inner.lock().expect("command output registry poisoned");
            let artifact = inner
                .artifacts
                .get(output_id)
                .ok_or_else(|| anyhow!("command output '{output_id}' not found or expired"))?;
            if artifact.kind != ArtifactKind::Pty {
                return Err(anyhow!("combined chunks are only valid for PTY output"));
            }
            drop(inner);
        }

        let mut inner = self.inner.lock().expect("command output registry poisoned");
        let sequence = inner.next_sequence;
        inner.next_sequence = inner.next_sequence.saturating_add(1);
        let artifact = inner
            .artifacts
            .get_mut(output_id)
            .ok_or_else(|| anyhow!("command output '{output_id}' not found or expired"))?;
        if artifact.kind == ArtifactKind::Pty && stream != OutputStream::Combined {
            return Err(anyhow!("PTY output only supports the combined stream"));
        }
        if artifact.kind == ArtifactKind::Command && stream == OutputStream::Combined {
            return Err(anyhow!(
                "command output chunks must retain stdout or stderr identity"
            ));
        }

        let stream_start = match stream {
            OutputStream::Stdout => artifact.stdout_bytes,
            OutputStream::Stderr => artifact.stderr_bytes,
            OutputStream::Combined => artifact.combined_bytes,
        };
        let combined_start = artifact.combined_bytes;
        let length = bytes.len();
        match stream {
            OutputStream::Stdout => artifact.stdout_bytes += length as u64,
            OutputStream::Stderr => artifact.stderr_bytes += length as u64,
            OutputStream::Combined => {}
        }
        artifact.combined_bytes += length as u64;
        artifact.retained_bytes += length;
        let coalesced = artifact.chunks.back_mut().is_some_and(|chunk| {
            if chunk.stream == stream
                && chunk.consumed == 0
                && chunk.bytes.len() + bytes.len() <= OUTPUT_CHUNK_COALESCE_BYTES
            {
                chunk.bytes.append(&mut bytes);
                true
            } else {
                false
            }
        });
        if !coalesced {
            artifact.chunks.push_back(OutputChunk {
                sequence,
                stream,
                stream_start,
                combined_start,
                bytes,
                consumed: 0,
            });
        }
        inner.retained_bytes += length;

        while inner
            .artifacts
            .get(output_id)
            .is_some_and(|artifact| artifact.chunks.len() > MAX_RETAINED_CHUNKS_PER_ARTIFACT)
        {
            let oldest_chunk_bytes = inner
                .artifacts
                .get(output_id)
                .and_then(|artifact| artifact.chunks.front())
                .map(OutputChunk::retained_len)
                .unwrap_or(0);
            drop_from_artifact(&mut inner, output_id, oldest_chunk_bytes.max(1));
        }
        while inner
            .artifacts
            .get(output_id)
            .is_some_and(|artifact| artifact.retained_bytes > self.limits.per_command_bytes)
        {
            let excess = inner
                .artifacts
                .get(output_id)
                .map(|artifact| artifact.retained_bytes - self.limits.per_command_bytes)
                .unwrap_or(0);
            drop_from_artifact(&mut inner, output_id, excess.max(1));
        }
        while inner.retained_bytes > self.limits.per_session_bytes {
            let Some(oldest_id) = inner
                .artifacts
                .iter()
                .filter_map(|(id, artifact)| {
                    artifact
                        .chunks
                        .front()
                        .map(|chunk| (id.clone(), chunk.sequence))
                })
                .min_by_key(|(_, sequence)| *sequence)
                .map(|(id, _)| id)
            else {
                break;
            };
            let excess = inner.retained_bytes - self.limits.per_session_bytes;
            drop_from_artifact(&mut inner, &oldest_id, excess.max(1));
        }
        Ok(())
    }

    pub fn stats(&self, output_id: &str) -> Result<ArtifactStats> {
        let inner = self.inner.lock().expect("command output registry poisoned");
        let artifact = inner
            .artifacts
            .get(output_id)
            .ok_or_else(|| anyhow!("command output '{output_id}' not found or expired"))?;
        Ok(ArtifactStats {
            stdout_bytes: artifact.stdout_bytes,
            stderr_bytes: artifact.stderr_bytes,
            combined_bytes: artifact.combined_bytes,
            retained_bytes: artifact.retained_bytes,
            overflowed: artifact.overflowed,
        })
    }

    pub fn page(
        &self,
        output_id: &str,
        stream: OutputStream,
        offset: u64,
        limit: usize,
    ) -> Result<OutputPage> {
        if limit == 0 {
            return Err(anyhow!("limit must be at least 1"));
        }
        if limit > MAX_OUTPUT_PAGE_BYTES {
            return Err(anyhow!(
                "limit must not exceed {MAX_OUTPUT_PAGE_BYTES} bytes"
            ));
        }
        let inner = self.inner.lock().expect("command output registry poisoned");
        let artifact = inner
            .artifacts
            .get(output_id)
            .ok_or_else(|| anyhow!("command output '{output_id}' not found or expired"))?;
        if artifact.kind == ArtifactKind::Pty && stream != OutputStream::Combined {
            return Err(anyhow!("PTY output only supports stream=combined"));
        }

        let (retained_start, retained_end) = artifact.retained_range(stream);
        if offset > retained_end {
            return Err(anyhow!(
                "offset {offset} is after {stream:?} output end {retained_end}"
            ));
        }
        let actual_offset = offset.max(retained_start);
        let overflowed = artifact.overflowed || actual_offset != offset;
        let wanted = limit.saturating_add(3);
        let (mut bytes, mut segments) = artifact.bytes_from(stream, actual_offset, wanted);
        let available = retained_end.saturating_sub(actual_offset) as usize;
        let target = available.min(limit);
        let consumed = utf8_page_len(&bytes, target, available <= limit);
        bytes.truncate(consumed);
        clip_segments(&mut segments, stream, actual_offset, consumed as u64);
        let next_offset = actual_offset + consumed as u64;

        Ok(OutputPage {
            output_id: output_id.to_string(),
            stream,
            offset: actual_offset,
            content: String::from_utf8_lossy(&bytes).into_owned(),
            next_offset,
            eof: next_offset >= retained_end,
            overflowed,
            retained_start,
            retained_end,
            segments: if stream == OutputStream::Combined {
                segments
            } else {
                Vec::new()
            },
        })
    }

    #[cfg(test)]
    pub fn preview(
        &self,
        output_id: &str,
        stream: OutputStream,
        max_chars: usize,
    ) -> Result<(String, bool)> {
        let inner = self.inner.lock().expect("command output registry poisoned");
        let artifact = inner
            .artifacts
            .get(output_id)
            .ok_or_else(|| anyhow!("command output '{output_id}' not found or expired"))?;
        validate_stream(artifact, stream)?;
        let (start, end) = artifact.retained_range(stream);
        Ok(render_preview(artifact, stream, start, end, max_chars))
    }

    pub(crate) fn command_previews(
        &self,
        output_id: &str,
        max_chars: usize,
    ) -> Result<((String, bool), (String, bool))> {
        let inner = self.inner.lock().expect("command output registry poisoned");
        let artifact = inner
            .artifacts
            .get(output_id)
            .ok_or_else(|| anyhow!("command output '{output_id}' not found or expired"))?;
        validate_stream(artifact, OutputStream::Stdout)?;
        let (stdout_start, stdout_end) = artifact.retained_range(OutputStream::Stdout);
        let (stderr_start, stderr_end) = artifact.retained_range(OutputStream::Stderr);
        let (stdout_budget, stderr_budget) = preview_budgets(
            max_chars,
            stdout_end.saturating_sub(stdout_start) as usize,
            stderr_end.saturating_sub(stderr_start) as usize,
        );
        Ok((
            render_preview(
                artifact,
                OutputStream::Stdout,
                stdout_start,
                stdout_end,
                stdout_budget,
            ),
            render_preview(
                artifact,
                OutputStream::Stderr,
                stderr_start,
                stderr_end,
                stderr_budget,
            ),
        ))
    }

    pub(crate) fn preview_since(
        &self,
        output_id: &str,
        stream: OutputStream,
        requested_start: u64,
        max_chars: usize,
    ) -> Result<OutputPreview> {
        let inner = self.inner.lock().expect("command output registry poisoned");
        let artifact = inner
            .artifacts
            .get(output_id)
            .ok_or_else(|| anyhow!("command output '{output_id}' not found or expired"))?;
        validate_stream(artifact, stream)?;
        let (retained_start, end_offset) = artifact.retained_range(stream);
        let start_offset = requested_start.max(retained_start).min(end_offset);
        let (content, preview_truncated) =
            render_preview(artifact, stream, start_offset, end_offset, max_chars);
        Ok(OutputPreview {
            start_offset,
            end_offset,
            content,
            truncated: preview_truncated || start_offset != requested_start,
            overflowed: artifact.overflowed,
        })
    }

    pub fn clear(&self) {
        let mut inner = self.inner.lock().expect("command output registry poisoned");
        inner.artifacts.clear();
        inner.retained_bytes = 0;
    }

    #[cfg(test)]
    pub fn retained_bytes(&self) -> usize {
        self.inner
            .lock()
            .expect("command output registry poisoned")
            .retained_bytes
    }
}

impl Artifact {
    fn retained_range(&self, stream: OutputStream) -> (u64, u64) {
        let end = match stream {
            OutputStream::Combined => self.combined_bytes,
            OutputStream::Stdout => self.stdout_bytes,
            OutputStream::Stderr => self.stderr_bytes,
        };
        let start = self
            .chunks
            .iter()
            .find(|chunk| stream == OutputStream::Combined || chunk.stream == stream)
            .map(|chunk| match stream {
                OutputStream::Combined => chunk.retained_combined_start(),
                OutputStream::Stdout | OutputStream::Stderr => chunk.retained_stream_start(),
            })
            .unwrap_or(end);
        (start, end)
    }

    fn bytes_from(
        &self,
        stream: OutputStream,
        offset: u64,
        limit: usize,
    ) -> (Vec<u8>, Vec<OutputSegment>) {
        let mut bytes = Vec::with_capacity(limit.min(8192));
        let mut segments = Vec::new();
        for chunk in &self.chunks {
            if stream != OutputStream::Combined && chunk.stream != stream {
                continue;
            }
            let chunk_start = match stream {
                OutputStream::Combined => chunk.retained_combined_start(),
                OutputStream::Stdout | OutputStream::Stderr => chunk.retained_stream_start(),
            };
            let chunk_end = chunk_start + chunk.retained_len() as u64;
            if chunk_end <= offset {
                continue;
            }
            if bytes.len() >= limit {
                break;
            }
            let skip = offset.saturating_sub(chunk_start) as usize;
            let available = &chunk.retained()[skip.min(chunk.retained_len())..];
            let take = available.len().min(limit - bytes.len());
            if take == 0 {
                continue;
            }
            let combined_start = chunk.retained_combined_start() + skip as u64;
            let stream_start = chunk.retained_stream_start() + skip as u64;
            bytes.extend_from_slice(&available[..take]);
            segments.push(OutputSegment {
                sequence: chunk.sequence,
                stream: chunk.stream,
                combined_start,
                combined_end: combined_start + take as u64,
                stream_start,
                stream_end: stream_start + take as u64,
            });
        }
        (bytes, segments)
    }
}

fn validate_stream(artifact: &Artifact, stream: OutputStream) -> Result<()> {
    if artifact.kind == ArtifactKind::Pty && stream != OutputStream::Combined {
        return Err(anyhow!("PTY output only supports stream=combined"));
    }
    Ok(())
}

fn preview_budgets(total: usize, stdout_bytes: usize, stderr_bytes: usize) -> (usize, usize) {
    if stdout_bytes == 0 {
        return (0, total);
    }
    if stderr_bytes == 0 {
        return (total, 0);
    }
    let mut stdout_budget = total / 2;
    let mut stderr_budget = total - stdout_budget;
    if stdout_bytes < stdout_budget {
        stderr_budget += stdout_budget - stdout_bytes;
        stdout_budget = stdout_bytes;
    }
    if stderr_bytes < stderr_budget {
        stdout_budget += stderr_budget - stderr_bytes;
        stderr_budget = stderr_bytes;
    }
    (stdout_budget, stderr_budget)
}

fn render_preview(
    artifact: &Artifact,
    stream: OutputStream,
    start: u64,
    end: u64,
    max_chars: usize,
) -> (String, bool) {
    let retained_len = end.saturating_sub(start) as usize;
    if max_chars == 0 {
        return (String::new(), retained_len > 0);
    }

    // Four bytes is the largest UTF-8 scalar. This bounded probe proves that
    // short multibyte output fits the character budget without reading a
    // potentially GiB-sized retained artifact into a second allocation.
    let full_probe_limit = max_chars.saturating_mul(4).saturating_add(4);
    if retained_len <= full_probe_limit {
        let (bytes, _) = artifact.bytes_from(stream, start, retained_len);
        let text = String::from_utf8_lossy(&bytes);
        if text.chars().count() <= max_chars {
            return (text.into_owned(), false);
        }
        return (
            truncate_decoded_preview(&text, max_chars, retained_len),
            true,
        );
    }

    let head_chars = max_chars / 2;
    let tail_chars = max_chars.saturating_sub(head_chars);
    let head_bytes = head_chars.saturating_mul(4).saturating_add(4);
    let tail_bytes = tail_chars.saturating_mul(4).saturating_add(4);
    let (head_source, _) = artifact.bytes_from(stream, start, head_bytes);
    let (tail_source, _) =
        artifact.bytes_from(stream, end.saturating_sub(tail_bytes as u64), tail_bytes);
    let head: String = String::from_utf8_lossy(&head_source)
        .chars()
        .take(head_chars)
        .collect();
    let tail_reversed: Vec<char> = String::from_utf8_lossy(&tail_source)
        .chars()
        .rev()
        .take(tail_chars)
        .collect();
    let tail: String = tail_reversed.into_iter().rev().collect();
    (
        format!("{head}...\n...[preview truncated from {retained_len} retained bytes]...\n{tail}"),
        true,
    )
}

fn truncate_decoded_preview(text: &str, max_chars: usize, retained_len: usize) -> String {
    let head_chars = max_chars / 2;
    let tail_chars = max_chars.saturating_sub(head_chars);
    let head: String = text.chars().take(head_chars).collect();
    let tail_reversed: Vec<char> = text.chars().rev().take(tail_chars).collect();
    let tail: String = tail_reversed.into_iter().rev().collect();
    format!("{head}...\n...[preview truncated from {retained_len} retained bytes]...\n{tail}")
}

fn drop_from_artifact(inner: &mut RegistryInner, output_id: &str, bytes: usize) {
    let RegistryInner {
        artifacts,
        retained_bytes,
        ..
    } = inner;
    let Some(artifact) = artifacts.get_mut(output_id) else {
        return;
    };
    artifact.overflowed = true;
    drop_retained_prefix(artifact, retained_bytes, bytes);

    // stdout and stderr are independently pageable, while combined must remain
    // one contiguous suffix. If eviction exposes a continuation byte at the
    // first retained chunk of either stream, drop the intervening global prefix
    // too, then repeat because that may expose the other stream.
    while let Some(bytes_to_boundary) = prefix_to_unaligned_stream_boundary(artifact) {
        drop_retained_prefix(artifact, retained_bytes, bytes_to_boundary);
    }
}

fn drop_retained_prefix(
    artifact: &mut Artifact,
    total_retained_bytes: &mut usize,
    mut bytes: usize,
) {
    while bytes > 0 {
        let Some(front) = artifact.chunks.front_mut() else {
            break;
        };
        let amount = bytes.min(front.retained_len());
        front.consumed += amount;
        artifact.retained_bytes -= amount;
        *total_retained_bytes -= amount;
        bytes -= amount;
        if front.retained_len() == 0 {
            artifact.chunks.pop_front();
        }
    }
}

fn prefix_to_unaligned_stream_boundary(artifact: &Artifact) -> Option<usize> {
    let mut prefix_bytes = 0;
    let mut saw_stdout = false;
    let mut saw_stderr = false;
    for chunk in &artifact.chunks {
        let retained = &chunk.bytes[chunk.consumed..];
        if retained.is_empty() {
            continue;
        }
        let first_for_stream = match chunk.stream {
            OutputStream::Stdout if !saw_stdout => {
                saw_stdout = true;
                true
            }
            OutputStream::Stderr if !saw_stderr => {
                saw_stderr = true;
                true
            }
            OutputStream::Combined if !saw_stdout => {
                saw_stdout = true;
                true
            }
            _ => false,
        };
        if first_for_stream && retained[0] & 0b1100_0000 == 0b1000_0000 {
            let continuation_bytes = retained
                .iter()
                .take_while(|byte| **byte & 0b1100_0000 == 0b1000_0000)
                .count();
            return Some(prefix_bytes + continuation_bytes);
        }
        prefix_bytes += retained.len();
    }
    None
}

fn utf8_page_len(bytes: &[u8], target: usize, reaches_end: bool) -> usize {
    if bytes.len() <= target || reaches_end {
        return bytes.len().min(target.max(bytes.len()));
    }
    let candidate = &bytes[..target.min(bytes.len())];
    match std::str::from_utf8(candidate) {
        Ok(_) => candidate.len(),
        Err(error) if error.error_len().is_none() && error.valid_up_to() > 0 => error.valid_up_to(),
        Err(error) if error.error_len().is_none() => {
            let extra = bytes[target.min(bytes.len())..].iter().take(3).count();
            (target + extra).min(bytes.len())
        }
        Err(_) => candidate.len(),
    }
}

fn clip_segments(
    segments: &mut Vec<OutputSegment>,
    stream: OutputStream,
    offset: u64,
    consumed: u64,
) {
    let end = offset + consumed;
    segments.retain_mut(|segment| {
        let (segment_start, segment_end) = match stream {
            OutputStream::Combined => (segment.combined_start, segment.combined_end),
            OutputStream::Stdout | OutputStream::Stderr => {
                (segment.stream_start, segment.stream_end)
            }
        };
        let keep_start = segment_start.max(offset);
        let keep_end = segment_end.min(end);
        if keep_start >= keep_end {
            return false;
        }
        let leading = keep_start - segment_start;
        let length = keep_end - keep_start;
        segment.combined_start += leading;
        segment.combined_end = segment.combined_start + length;
        segment.stream_start += leading;
        segment.stream_end = segment.stream_start + length;
        true
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_budget_is_shared() {
        assert_eq!(preview_budgets(8_000, 10_000, 10_000), (4_000, 4_000));
        assert_eq!(preview_budgets(8_000, 100, 10_000), (100, 7_900));
        assert_eq!(preview_budgets(8_000, 10_000, 0), (8_000, 0));
    }

    #[test]
    fn command_previews_budget_retained_streams_atomically() {
        let registry = OutputRegistry::new(CommandOutputLimits {
            per_command_bytes: 1024,
            per_session_bytes: 1024,
        })
        .unwrap();
        let id = registry.create(ArtifactKind::Command);
        registry
            .append(&id, OutputStream::Stdout, vec![b'x'; 2048])
            .unwrap();
        registry
            .append(&id, OutputStream::Stderr, vec![b'e'; 1024])
            .unwrap();

        let ((stdout, stdout_truncated), (stderr, stderr_truncated)) =
            registry.command_previews(&id, 100).unwrap();
        assert_eq!((stdout, stdout_truncated), (String::new(), false));
        assert!(stderr_truncated);
        assert_eq!(
            stderr,
            format!(
                "{}...\n...[preview truncated from 1024 retained bytes]...\n{}",
                "e".repeat(50),
                "e".repeat(50)
            )
        );
    }

    #[test]
    fn pages_streams_and_combined_in_observed_order() {
        let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
        let id = registry.create(ArtifactKind::Command);
        registry
            .append(&id, OutputStream::Stdout, b"out-1\n".to_vec())
            .unwrap();
        registry
            .append(&id, OutputStream::Stderr, b"err-1\n".to_vec())
            .unwrap();
        registry
            .append(&id, OutputStream::Stdout, b"out-2\n".to_vec())
            .unwrap();

        assert_eq!(
            registry
                .page(&id, OutputStream::Stdout, 0, 64)
                .unwrap()
                .content,
            "out-1\nout-2\n"
        );
        assert_eq!(
            registry
                .page(&id, OutputStream::Stderr, 0, 64)
                .unwrap()
                .content,
            "err-1\n"
        );
        let combined = registry.page(&id, OutputStream::Combined, 0, 64).unwrap();
        assert_eq!(combined.content, "out-1\nerr-1\nout-2\n");
        assert_eq!(combined.segments.len(), 3);
        assert!(combined.eof);
    }

    #[test]
    fn paging_has_no_gaps_or_duplicates_in_any_view() {
        let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
        let id = registry.create(ArtifactKind::Command);
        for (stream, bytes) in [
            (OutputStream::Stdout, b"alpha".as_slice()),
            (OutputStream::Stderr, b"BRAVO".as_slice()),
            (OutputStream::Stdout, b"charlie".as_slice()),
            (OutputStream::Stderr, b"DELTA".as_slice()),
        ] {
            registry.append(&id, stream, bytes.to_vec()).unwrap();
        }

        for (stream, expected) in [
            (OutputStream::Stdout, "alphacharlie"),
            (OutputStream::Stderr, "BRAVODELTA"),
            (OutputStream::Combined, "alphaBRAVOcharlieDELTA"),
        ] {
            let mut offset = 0;
            let mut reconstructed = String::new();
            loop {
                let page = registry.page(&id, stream, offset, 5).unwrap();
                assert_eq!(page.offset, offset);
                assert!(page.next_offset > offset || page.eof);
                if stream == OutputStream::Combined {
                    let covered: u64 = page
                        .segments
                        .iter()
                        .map(|segment| segment.combined_end - segment.combined_start)
                        .sum();
                    assert_eq!(covered, page.content.len() as u64);
                }
                reconstructed.push_str(&page.content);
                offset = page.next_offset;
                if page.eof {
                    break;
                }
            }
            assert_eq!(reconstructed, expected);
        }
    }

    #[test]
    fn quotas_advance_exact_retained_ranges() {
        let registry = OutputRegistry::new(CommandOutputLimits {
            per_command_bytes: 8,
            per_session_bytes: 12,
        })
        .unwrap();
        let first = registry.create(ArtifactKind::Command);
        registry
            .append(&first, OutputStream::Stdout, b"0123456789".to_vec())
            .unwrap();
        let page = registry.page(&first, OutputStream::Stdout, 0, 32).unwrap();
        assert_eq!(page.offset, 2);
        assert_eq!(page.retained_start, 2);
        assert_eq!(page.retained_end, 10);
        assert_eq!(page.content, "23456789");
        assert!(page.overflowed);

        let second = registry.create(ArtifactKind::Command);
        registry
            .append(&second, OutputStream::Stderr, b"abcdefgh".to_vec())
            .unwrap();
        assert_eq!(registry.retained_bytes(), 12);
        let first_page = registry.page(&first, OutputStream::Stdout, 0, 32).unwrap();
        assert_eq!(first_page.retained_start, 6);
        assert_eq!(first_page.content, "6789");
        let snapshot = registry
            .preview_since(&first, OutputStream::Stdout, 0, 32)
            .unwrap();
        assert_eq!(snapshot.start_offset, 6);
        assert_eq!(snapshot.end_offset, 10);
        assert_eq!(snapshot.content, "6789");
        assert!(snapshot.truncated);
        assert!(snapshot.overflowed);
    }

    #[test]
    fn generated_pages_preserve_multibyte_text() {
        let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
        let id = registry.create(ArtifactKind::Command);
        registry
            .append(&id, OutputStream::Stdout, "a€b".as_bytes().to_vec())
            .unwrap();
        let first = registry.page(&id, OutputStream::Stdout, 0, 2).unwrap();
        assert_eq!(first.content, "a");
        let second = registry
            .page(&id, OutputStream::Stdout, first.next_offset, 4)
            .unwrap();
        assert_eq!(second.content, "€b");
        assert!(second.eof);
    }

    #[test]
    fn preview_budget_counts_unicode_scalars_not_bytes() {
        let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
        let id = registry.create(ArtifactKind::Command);
        registry
            .append(&id, OutputStream::Stdout, "éé".as_bytes().to_vec())
            .unwrap();
        assert_eq!(
            registry.preview(&id, OutputStream::Stdout, 2).unwrap(),
            ("éé".to_string(), false)
        );
    }

    #[test]
    fn quota_eviction_advances_to_a_utf8_boundary() {
        let registry = OutputRegistry::new(CommandOutputLimits {
            per_command_bytes: 4,
            per_session_bytes: 4,
        })
        .unwrap();
        let id = registry.create(ArtifactKind::Command);
        registry
            .append(&id, OutputStream::Stdout, "€€".as_bytes().to_vec())
            .unwrap();
        let page = registry.page(&id, OutputStream::Stdout, 0, 32).unwrap();
        assert_eq!(page.retained_start, 3);
        assert_eq!(page.content, "€");
        assert!(!page.content.contains('\u{fffd}'));
    }

    #[test]
    fn tiny_alternating_writes_have_a_bounded_chunk_count() {
        let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
        let id = registry.create(ArtifactKind::Command);
        for index in 0..=MAX_RETAINED_CHUNKS_PER_ARTIFACT {
            let stream = if index % 2 == 0 {
                OutputStream::Stdout
            } else {
                OutputStream::Stderr
            };
            registry.append(&id, stream, vec![b'x']).unwrap();
        }
        let inner = registry
            .inner
            .lock()
            .expect("command output registry poisoned");
        let artifact = inner.artifacts.get(&id).unwrap();
        assert_eq!(artifact.chunks.len(), MAX_RETAINED_CHUNKS_PER_ARTIFACT);
        assert!(artifact.overflowed);
    }

    #[test]
    fn clear_expires_output_ids() {
        let registry = OutputRegistry::new(CommandOutputLimits::default()).unwrap();
        let id = registry.create(ArtifactKind::Pty);
        registry
            .append(&id, OutputStream::Combined, b"hello".to_vec())
            .unwrap();
        registry.clear();

        assert!(registry.page(&id, OutputStream::Combined, 0, 32).is_err());
    }
    #[test]
    fn interleaved_quota_eviction_aligns_each_pageable_stream() {
        let registry = OutputRegistry::new(CommandOutputLimits {
            per_command_bytes: 5,
            per_session_bytes: 5,
        })
        .unwrap();
        let id = registry.create(ArtifactKind::Command);
        registry
            .append(&id, OutputStream::Stdout, vec![0xE2])
            .unwrap();
        registry
            .append(&id, OutputStream::Stderr, b"x".to_vec())
            .unwrap();
        registry
            .append(&id, OutputStream::Stdout, vec![0x82, 0xAC, b'o', b'k'])
            .unwrap();

        let stdout = registry.page(&id, OutputStream::Stdout, 0, 32).unwrap();
        let stderr = registry.page(&id, OutputStream::Stderr, 0, 32).unwrap();
        let combined = registry.page(&id, OutputStream::Combined, 0, 32).unwrap();
        assert_eq!(stdout.content, "ok");
        assert_eq!(stderr.content, "");
        assert_eq!(combined.content, "ok");
        assert!(!stdout.content.contains('\u{fffd}'));
        assert!(!combined.content.contains('\u{fffd}'));
    }
}
