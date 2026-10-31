//! Immutable release-local product knowledge. No filesystem, network, runtime
//! state, configuration or execution authority is consulted by retrieval.
use std::collections::HashSet;
use std::sync::LazyLock;

use anyhow::{bail, ensure, Context, Result};
use nac_contracts::DocumentRef;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const ROUTER: &str = include_str!("router.md");
pub const SKILL_NAME: &str = "nac-help";
pub const DESCRIPTION: &str = "NAC Guide (first-party, bundled): installed NAC setup, sessions/subagents, workspace/backends, models/auth, MCP, skills/instructions, permissions, recovery and managed differences. Use for questions about NAC or this app; coding tasks merely mentioning NAC do not trigger unrelated help.";
const PACK: &str = include_str!("pack.json");
const MAX_READ: usize = 6000;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuidePack {
    pub schema_version: u32,
    pub fingerprint: String,
    router_digest: String,
    pub documents: Vec<Document>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Document {
    pub document_id: String,
    pub title: String,
    pub source_path: String,
    pub content_digest: String,
    pub sections: Vec<Section>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Section {
    pub section_id: String,
    pub title: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct SearchHit {
    pub document_id: String,
    pub section_id: String,
    pub title: String,
    pub excerpt: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct SectionRead {
    pub reference: DocumentRef,
    pub source_path: String,
    pub content_digest: String,
    pub title: String,
    pub text: String,
    pub offset: usize,
    pub next_offset: Option<usize>,
    pub total_bytes: usize,
}

fn digest(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

impl GuidePack {
    fn parse(raw: &str) -> Result<Self> {
        ensure!(raw.len() <= 524288, "oversized guide manifest");
        let pack: Self =
            serde_json::from_str(raw).context("missing or malformed guide manifest")?;
        ensure!(
            pack.schema_version == 1,
            "unsupported guide manifest schema"
        );
        ensure!(
            !pack.documents.is_empty() && pack.documents.len() <= 64,
            "invalid guide document count"
        );
        ensure!(
            pack.router_digest == digest(ROUTER),
            "guide router digest mismatch"
        );
        let mut fingerprint_input = format!("1\n{}\n", pack.router_digest);
        let mut documents = HashSet::new();
        for document in &pack.documents {
            ensure!(
                valid_id(&document.document_id) && documents.insert(&document.document_id),
                "invalid/duplicate guide document ID"
            );
            ensure!(
                !document.source_path.starts_with('/')
                    && !document.source_path.split('/').any(|part| part == ".."),
                "invalid guide source path"
            );
            ensure!(
                !document.sections.is_empty() && document.sections.len() <= 128,
                "invalid guide section count"
            );
            let mut sections = HashSet::new();
            let mut hasher = Sha256::new();
            for section in &document.sections {
                ensure!(
                    valid_id(&section.section_id) && sections.insert(&section.section_id),
                    "invalid/duplicate guide section ID"
                );
                hasher.update(section.text.as_bytes());
            }
            ensure!(
                document.content_digest == format!("{:x}", hasher.finalize()),
                "guide document digest mismatch"
            );
            fingerprint_input.push_str(&format!(
                "{}:{}:{}:{}\n",
                document.document_id, document.source_path, document.content_digest, document.title
            ));
            for section in &document.sections {
                fingerprint_input.push_str(&format!("{}:{}\n", section.section_id, section.title));
            }
        }
        ensure!(
            pack.fingerprint == digest(fingerprint_input),
            "guide fingerprint mismatch"
        );
        Ok(pack)
    }

    pub fn document(&self, document_id: &str) -> Result<&Document> {
        ensure!(valid_id(document_id), "invalid guide document ID");
        self.documents
            .iter()
            .find(|doc| doc.document_id == document_id)
            .with_context(|| format!("unknown guide document: {document_id}"))
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
        ensure!(
            query.len() <= 512 && (1..=20).contains(&limit),
            "query or result limit exceeds guide bounds"
        );
        let terms = terms(query);
        if terms.is_empty() && !query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let mut hits = Vec::new();
        for doc in &self.documents {
            for section in &doc.sections {
                if query.trim().is_empty() && section.section_id != "overview" {
                    continue;
                }
                let title =
                    format!("{} {} {}", doc.document_id, doc.title, section.title).to_lowercase();
                let text = section.text.to_lowercase();
                let score = terms
                    .iter()
                    .map(|term| {
                        usize::from(title.contains(term)) * 8 + usize::from(text.contains(term))
                    })
                    .sum::<usize>();
                let matched = terms
                    .iter()
                    .filter(|term| title.contains(term.as_str()) || text.contains(term.as_str()))
                    .count();
                if matched > terms.len() / 2 || query.trim().is_empty() {
                    hits.push((score, doc, section));
                }
            }
        }
        hits.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then_with(|| a.1.document_id.cmp(&b.1.document_id))
                .then_with(|| a.2.section_id.cmp(&b.2.section_id))
        });
        let mut seen_documents = HashSet::new();
        Ok(hits
            .into_iter()
            .filter(|(_, doc, _)| seen_documents.insert(&doc.document_id))
            .take(limit)
            .map(|(_, doc, section)| SearchHit {
                document_id: doc.document_id.clone(),
                section_id: section.section_id.clone(),
                title: format!("{} — {}", doc.title, section.title),
                excerpt: prefix(&section.text, 512).to_string(),
            })
            .collect())
    }

    pub fn read(
        &self,
        document_id: &str,
        section_id: &str,
        offset: usize,
        max_bytes: usize,
    ) -> Result<SectionRead> {
        ensure!(valid_id(section_id), "invalid guide section ID");
        ensure!(
            (1..=MAX_READ).contains(&max_bytes),
            "guide reads allow 1..=6000 bytes"
        );
        let doc = self.document(document_id)?;
        let Some(section) = doc
            .sections
            .iter()
            .find(|section| section.section_id == section_id)
        else {
            bail!("unknown guide section: {document_id}#{section_id}");
        };
        ensure!(
            section.text.is_char_boundary(offset),
            "invalid guide offset"
        );
        let text = prefix(&section.text[offset..], max_bytes);
        ensure!(
            !text.is_empty() || offset == section.text.len(),
            "max_bytes cannot split a UTF-8 character"
        );
        let end = offset + text.len();
        Ok(SectionRead {
            reference: DocumentRef {
                document_id: document_id.to_owned(),
                section_id: Some(section_id.to_owned()),
            },
            source_path: doc.source_path.clone(),
            content_digest: doc.content_digest.clone(),
            title: section.title.clone(),
            text: text.to_owned(),
            offset,
            next_offset: (end < section.text.len()).then_some(end),
            total_bytes: section.text.len(),
        })
    }
}

fn prefix(text: &str, max_bytes: usize) -> &str {
    let mut end = text.len().min(max_bytes);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

fn terms(query: &str) -> Vec<String> {
    query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|term| {
            term.len() > 1
                && ![
                    "how", "do", "does", "what", "where", "why", "can", "this", "the", "my", "is",
                    "are", "to", "in", "nac", "with", "mean",
                ]
                .contains(term)
        })
        .map(str::to_owned)
        .collect()
}

pub fn bundled() -> Result<&'static GuidePack> {
    static BUNDLED: LazyLock<Result<GuidePack, String>> =
        LazyLock::new(|| GuidePack::parse(PACK).map_err(|error| error.to_string()));
    BUNDLED
        .as_ref()
        .map_err(|error| anyhow::anyhow!("bundled NAC Guide unavailable: {error}"))
}

/// Small routing instruction for primary agents. The corpus stays out of prompts.
pub(crate) fn primary_prompt() -> String {
    format!("\n\n## NAC product self-help\n\nAvailable first-party skill: nac-help — {DESCRIPTION}\nFor ordinary questions about NAC, this app, its setup or capabilities (including MCP, skill locations, direct-with-orchestrator and subagent search), use nac_guide to find and read the installed references before answering. Explicit $nac-help supplies the same router. Generic coding work merely mentioning NAC does not require help. Answer product questions directly with release-local citations; orchestrators may use this read-only tool without a worker dispatch. For delegated help, select skills: [\"nac-help\"] when dispatching a worker. Never invent current configuration or treat help as permission to execute work. {ROUTER}")
}

#[cfg(test)]
mod tests;
