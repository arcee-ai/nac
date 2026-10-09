//! Typed provenance lives with canonical log rows, never in User-prefix authority.
use super::*;
use crate::types::Message;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TerminalSelectionAttribution {
    pub protocol_version: u8,
    pub intent_sha256: String,
    pub source_kind: TerminalSelectionSourceKind,
    pub admission_id: String,
    pub capture_id: String,
    pub source_session_id: String,
    pub terminal_id: String,
    pub owner_instance_id: String,
    pub client_capture_time_ms: Option<String>,
}
impl TerminalSelectionAttribution {
    fn from_intent(intent: &TerminalSelectionIntent) -> Result<Self> {
        Ok(Self {
            protocol_version: 1,
            intent_sha256: intent.digest()?,
            source_kind: intent.source_kind.clone(),
            admission_id: intent.admission_id.clone(),
            capture_id: intent.capture_id.clone(),
            source_session_id: intent.source_session_id.clone(),
            terminal_id: intent.terminal_id.clone(),
            owner_instance_id: intent.owner_instance_id.clone(),
            client_capture_time_ms: intent.client_capture_time_ms.clone(),
        })
    }
    // Called only for an existing typed annotation. A lookalike User body
    // without that row annotation never enters this validation/classification.
    pub(crate) fn validate_message(&self, message: &Message) -> Result<()> {
        let Message::User { content } = message else {
            anyhow::bail!("selection attribution requires canonical user evidence");
        };
        let intent = decode_intent(content)?;
        if Self::from_intent(&intent)? != *self {
            anyhow::bail!("selection attribution differs from canonical intent");
        }
        Ok(())
    }
}
fn decode_intent(content: &str) -> Result<TerminalSelectionIntent> {
    let encoded = content
        .strip_prefix(super::terminal_selection::ENVELOPE_PREFIX)
        .ok_or_else(|| anyhow!("selection canonical framing differs"))?;
    let intent: TerminalSelectionIntent =
        serde_json::from_str(encoded).map_err(|_| anyhow!("invalid canonical selection intent"))?;
    intent.validate()?;
    if intent.envelope()? != content {
        anyhow::bail!("selection canonical encoding differs");
    }
    Ok(intent)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct TerminalSelectionReference {
    /// Absolute canonical transcript index, including any system head.
    pub message_index: u64,
    pub attribution: TerminalSelectionAttribution,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct TerminalSelectionProvenance {
    pub count: u64,
    pub digest: String,
    pub recent: Vec<TerminalSelectionReference>,
}
struct Accumulator {
    count: u64,
    digest: Sha256,
    recent: VecDeque<TerminalSelectionReference>,
}
impl Accumulator {
    fn new() -> Self {
        let mut digest = Sha256::new();
        digest.update(b"nac-terminal-selection-provenance-v1\0");
        Self {
            count: 0,
            digest,
            recent: VecDeque::new(),
        }
    }
    fn push(&mut self, reference: TerminalSelectionReference) -> Result<()> {
        let encoded = serde_json::to_vec(&reference)?;
        self.digest.update((encoded.len() as u64).to_be_bytes());
        self.digest.update(encoded);
        self.count = self
            .count
            .checked_add(1)
            .context("selection count overflowed")?;
        if self.recent.len() == 4 {
            self.recent.pop_front();
        }
        self.recent.push_back(reference);
        Ok(())
    }
    fn finish(self) -> TerminalSelectionProvenance {
        TerminalSelectionProvenance {
            count: self.count,
            digest: format!("{:x}", self.digest.finalize()),
            recent: self.recent.into_iter().collect(),
        }
    }
}

// Stamp only after a genuine identified inbox record has passed immutable
// identity/content checks, within the SAME delivery transaction as its User row.
pub(super) fn stamp_inbox_attribution(
    tx: &Transaction<'_>,
    session: &str,
    item: i64,
    index: u64,
    content: &str,
) -> Result<()> {
    let (identity,digest,stored): (Option<String>,Option<String>,String) = tx.query_row(
        "SELECT admission_id,admission_digest,content FROM session_inbox WHERE session_id=?1 AND id=?2",
        params![session,item], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?;
    let Some(identity) = identity else {
        if digest.is_some() {
            anyhow::bail!("invalid inbox attribution identity");
        }
        return Ok(());
    };
    let intent = decode_intent(&stored)?;
    if stored != content
        || intent.source_session_id != session
        || intent.admission_id != identity
        || Some(intent.digest()?) != digest
    {
        anyhow::bail!("inbox attribution identity/content mismatch");
    }
    let attribution = TerminalSelectionAttribution::from_intent(&intent)?;
    stamp(tx, session, index, &attribution)
}
fn stamp(
    tx: &Transaction<'_>,
    session: &str,
    index: u64,
    attribution: &TerminalSelectionAttribution,
) -> Result<()> {
    let (id,json): (i64,String) = tx.query_row(
        "SELECT id,event_json FROM thread_events WHERE session_id=?1 AND thread_name=?2 AND json_extract(event_json,'$.nac_transcript_message.idx')=?3 ORDER BY id DESC LIMIT 1",
        params![session,ORCHESTRATOR_STEERING_TARGET,index], |row| Ok((row.get(0)?,row.get(1)?)))?;
    let mut entry = super::transcript::decode_transcript_log_entry(&json)
        .ok_or_else(|| anyhow!("invalid selection transcript row"))?;
    if entry.idx != index || entry.kind != TranscriptMessageKind::User {
        anyhow::bail!("selection transcript position/kind differs");
    }
    let message: Message = serde_json::from_str(&entry.message_json)?;
    attribution.validate_message(&message)?;
    entry.terminal_selection_attribution = Some(attribution.clone());
    let payload = serde_json::json!({"nac_transcript_message":entry});
    tx.execute(
        "UPDATE thread_events SET event_json=?1 WHERE id=?2",
        params![serde_json::to_string(&payload)?, id],
    )?;
    Ok(())
}
#[cfg(test)]
thread_local! { static SNAPSHOT_STEPS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
fn next_snapshot_row(
    rows: &mut rusqlite::Rows<'_>,
    expected: &mut u64,
) -> Result<Option<(u64, String)>> {
    #[cfg(test)]
    SNAPSHOT_STEPS.with(|steps| steps.set(steps.get() + 1));
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let index: u64 = row.get(0)?;
    if index != *expected {
        anyhow::bail!("selection snapshot cursor ordering differs");
    }
    *expected = expected
        .checked_add(1)
        .context("selection snapshot index overflowed")?;
    Ok(Some((index, row.get(1)?)))
}
fn references(
    conn: &Connection,
    session: &str,
    start: u64,
    end: u64,
    mut accept: impl FnMut(TerminalSelectionReference) -> Result<()>,
) -> Result<()> {
    // Merge two ordered cursors. A per-annotation json_extract on a large
    // folded blob would repeatedly scan/re-read the entire snapshot. json_each
    // walks it once; only one current message/reference is held here.
    let mut snapshot_query=conn.prepare("SELECT j.key,j.value FROM sessions s,json_each(s.messages_json) j WHERE s.session_id=?1 AND j.key>=?2 AND j.key<?3")?;
    let mut snapshot_rows = snapshot_query.query(params![session, start, end])?;
    let mut snapshot_current = None;
    let mut snapshot_initialized = false;
    let mut snapshot_expected = start;
    let mut query=conn.prepare("SELECT event_json FROM thread_events WHERE session_id=?1 AND thread_name=?2 AND json_extract(event_json,'$.nac_transcript_message.idx')>=?3 AND json_extract(event_json,'$.nac_transcript_message.idx')<?4 AND json_extract(event_json,'$.nac_transcript_message.terminal_selection_attribution') IS NOT NULL ORDER BY id ASC")?;
    let mut rows = query.query(params![session, ORCHESTRATOR_STEERING_TARGET, start, end])?;
    let mut prior = None;
    while let Some(row) = rows.next()? {
        let json: String = row.get(0)?;
        let entry = super::transcript::decode_transcript_log_entry(&json)
            .ok_or_else(|| anyhow!("invalid selection transcript annotation"))?;
        if prior.is_some_and(|index| index >= entry.idx) {
            anyhow::bail!("selection attribution order differs");
        }
        prior = Some(entry.idx);
        if !snapshot_initialized {
            snapshot_current = next_snapshot_row(&mut snapshot_rows, &mut snapshot_expected)?;
            snapshot_initialized = true;
        }
        while snapshot_current
            .as_ref()
            .is_some_and(|(index, _)| *index < entry.idx)
        {
            snapshot_current = next_snapshot_row(&mut snapshot_rows, &mut snapshot_expected)?;
        }
        if let Some((index, snapshot_json)) = snapshot_current
            .as_ref()
            .filter(|(index, _)| *index == entry.idx)
        {
            let _ = index;
            let snapshot_message: Message = serde_json::from_str(snapshot_json)?;
            if serde_json::to_string(&snapshot_message)? != entry.message_json {
                continue;
            }
        }
        if entry.kind != TranscriptMessageKind::User {
            anyhow::bail!("selection annotation kind differs");
        }
        let attribution = entry
            .terminal_selection_attribution
            .ok_or_else(|| anyhow!("missing selection annotation"))?;
        let message: Message = serde_json::from_str(&entry.message_json)?;
        attribution.validate_message(&message)?;
        accept(TerminalSelectionReference {
            message_index: entry.idx,
            attribution,
        })?;
    }
    Ok(())
}
coordinated_command! {
pub fn load_terminal_selection_references(path:&Path,session:&str,start:u64,end:u64)->Result<Vec<TerminalSelectionReference>> {
    let mut conn=open_runtime_connection(path)?;
    let conn=conn.transaction()?;
    let mut found=Vec::new();
    references(&conn,session,start,end,|reference| { found.push(reference); Ok(()) })?;
    Ok(found)
}
command LoadTerminalSelectionReferencesCommand { session:String=session.to_owned(), start:u64=start, end:u64=end }
call |command| (&command.session,command.start,command.end)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session));
port public;
}
// Existing all-history frontend metadata read: times and typed annotations
// share one snapshot/checkout instead of adding a fourth connection.
coordinated_command! {
pub(crate) fn load_terminal_selection_history_metadata(path:&Path,session:&str,blob_len:u64,total:u64)->Result<(Vec<Option<String>>,Vec<TerminalSelectionReference>)> {
    let mut connection=open_runtime_connection(path)?;
    let snapshot=connection.transaction()?;
    let mut times=vec![None; usize::try_from(blob_len.min(total))?];
    let mut query=snapshot.prepare("SELECT created_at FROM thread_events WHERE session_id=?1 AND thread_name=?2 AND json_extract(event_json,'$.nac_transcript_message.idx')>=?3 AND json_extract(event_json,'$.nac_transcript_message.idx')<?4 ORDER BY id ASC")?;
    for time in query.query_map(params![session,ORCHESTRATOR_STEERING_TARGET,blob_len,total],|row| row.get::<_,String>(0))? { times.push(Some(time?)); }
    times.resize(usize::try_from(total)?,None);
    let mut found=Vec::new();
    references(&snapshot,session,0,total,|reference| { found.push(reference); Ok(()) })?;
    Ok((times,found))
}
command LoadTerminalSelectionHistoryMetadataCommand { session:String=session.to_owned(), blob_len:u64=blob_len,total:u64=total }
call |command| (&command.session,command.blob_len,command.total)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session));
port public;
}
coordinated_command! {
pub(crate) fn load_terminal_selection_provenance(path:&Path,session:&str,boundaries:&[u64])->Result<Vec<TerminalSelectionProvenance>> {
    if boundaries.len()>4 { anyhow::bail!("selection projection boundary count exceeds limit"); }
    let mut conn=open_runtime_connection(path)?;
    let conn=conn.transaction()?;
    let mut states=boundaries.iter().map(|_|Accumulator::new()).collect::<Vec<_>>();
    references(&conn,session,0,boundaries.iter().copied().max().unwrap_or(0),|reference| {
        for (boundary,state) in boundaries.iter().zip(&mut states) {
            if reference.message_index<*boundary { state.push(reference.clone())?; }
        }
        Ok(())
    })?;
    Ok(states.into_iter().map(Accumulator::finish).collect())
}
command LoadTerminalSelectionProvenanceCommand { session:String=session.to_owned(), boundaries:Vec<u64>=boundaries.to_vec() }
call |command| (&command.session,&command.boundaries)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session));
port public;
}
coordinated_command! {
pub fn copy_terminal_selection_attributions(path:&Path,source:&str,target:&str,prefix_len:u64)->Result<()> {
    if source==target { anyhow::bail!("selection attribution copy requires distinct sessions"); }
    let mut conn=open_runtime_connection(path)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    references(&tx,source,0,prefix_len,|reference| stamp(&tx,target,reference.message_index,&reference.attribution))?;
    tx.commit()?;
    Ok(())
}
command CopyTerminalSelectionAttributionsCommand { source:String=source.to_owned(), target:String=target.to_owned(), prefix_len:u64=prefix_len }
call |command| (&command.source,&command.target,command.prefix_len)
correlation |command| crate::telemetry::Correlation::session(Some(&command.source));
port public;
}

#[cfg(test)]
#[path = "transcript_selection_tests.rs"]
mod tests;

// Bulk fixture avoids thousands of unrelated run-lifecycle transitions while
// exercising the real identified-row verification and annotation stamper.
#[cfg(test)]
pub(crate) fn seed_selection_provenance_history_for_test(
    path: &Path,
    intents: &[TerminalSelectionIntent],
) -> Result<Vec<Message>> {
    let mut connection = open_runtime_connection(path)?;
    let tx = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut messages = Vec::new();
    for (index, intent) in intents.iter().enumerate() {
        let content = intent.envelope()?;
        let now = now_utc();
        tx.execute("INSERT INTO session_inbox(session_id,delivery,content,created_at,updated_at,admission_id,admission_digest) VALUES(?1,'queue',?2,?3,?3,?4,?5)",params![intent.source_session_id,content,now,intent.admission_id,intent.digest()?])?;
        let item = tx.last_insert_rowid();
        let message = Message::User {
            content: content.clone(),
        };
        super::transcript::append_messages_in_transaction(
            &tx,
            &intent.source_session_id,
            index as u64,
            std::slice::from_ref(&message),
        )?;
        stamp_inbox_attribution(&tx, &intent.source_session_id, item, index as u64, &content)?;
        tx.execute("UPDATE session_inbox SET status='delivered',delivered_run_id='fixture',delivered_at=?1 WHERE id=?2",params![now,item])?;
        messages.push(message);
    }
    tx.commit()?;
    Ok(messages)
}
