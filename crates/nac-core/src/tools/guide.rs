//! Prepared adapter for the inward immutable guide contract.
use futures_util::future::BoxFuture;
use serde::Deserialize;
use serde_json::{json, Value};

use super::kernel::{NativeTool, PermissionResource, ToolAdmission, ToolCallContext, ToolServices};
use super::ToolResult;
use crate::types::{FunctionDef, ToolDefinition};

pub(crate) const NAME: &str = "nac_guide";
pub(crate) struct GuideTool;

#[derive(Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum GuideInput {
    Manifest {
        expected_fingerprint: Option<String>,
    },
    Index {
        query: Option<String>,
        limit: Option<usize>,
        expected_fingerprint: Option<String>,
    },
    Read {
        document_id: String,
        section_id: Option<String>,
        offset: Option<usize>,
        max_bytes: Option<usize>,
        expected_fingerprint: Option<String>,
    },
}

pub(crate) fn definition() -> ToolDefinition {
    ToolDefinition {
        def_type: "function".into(),
        function: FunctionDef {
            name: NAME.into(),
            description: "Read/search the first-party installed NAC Guide. Offline immutable documentation, independent of host paths. Use for NAC product questions; returns readable excerpts, stable source refs, pack fingerprint and installed build identity. Does not inspect current settings or execute work. index searches topics; read without section_id gives an outline; read a section in bounded UTF-8 pages. Unknown topics/refs or stale fingerprints fail explicitly.".into(),
            parameters: json!({"type":"object","properties":{
                "operation":{"type":"string","enum":["manifest","index","read"]},
                "query":{"type":"string","maxLength":512},
                "limit":{"type":"integer","minimum":1,"maximum":20},
                "document_id":{"type":"string","maxLength":128},
                "section_id":{"type":"string","maxLength":128},
                "offset":{"type":"integer","minimum":0},
                "max_bytes":{"type":"integer","minimum":1,"maximum":6000},
                "expected_fingerprint":{"type":"string","maxLength":64}
            },"required":["operation"],"additionalProperties":false}),
        },
    }
}

impl GuideInput {
    fn expected_fingerprint(&self) -> Option<&str> {
        match self {
            Self::Manifest {
                expected_fingerprint,
            }
            | Self::Index {
                expected_fingerprint,
                ..
            }
            | Self::Read {
                expected_fingerprint,
                ..
            } => expected_fingerprint.as_deref(),
        }
    }

    fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.expected_fingerprint().is_none_or(
                |value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
            ),
            "fingerprint must be a SHA-256 digest"
        );
        match self {
            Self::Index { query, limit, .. } => {
                anyhow::ensure!(
                    query.as_ref().is_none_or(|value| value.len() <= 512),
                    "query exceeds 512 bytes"
                );
                anyhow::ensure!(
                    limit.is_none_or(|value| (1..=20).contains(&value)),
                    "limit must be 1..=20"
                );
            }
            Self::Read {
                document_id,
                section_id,
                max_bytes,
                offset,
                ..
            } => {
                for value in std::iter::once(document_id).chain(section_id.iter()) {
                    anyhow::ensure!(
                        !value.is_empty()
                            && value.len() <= 128
                            && value.bytes().all(|byte| byte.is_ascii_lowercase()
                                || byte.is_ascii_digit()
                                || byte == b'-'),
                        "invalid guide reference ID"
                    );
                }
                anyhow::ensure!(
                    max_bytes.is_none_or(|value| (1..=6000).contains(&value)),
                    "max_bytes must be 1..=6000"
                );
                anyhow::ensure!(
                    section_id.is_some() || (offset.is_none() && max_bytes.is_none()),
                    "section_id is required for a paged read"
                );
            }
            Self::Manifest { .. } => {}
        }
        Ok(())
    }
}

impl NativeTool for GuideTool {
    type Input = GuideInput;
    fn definition(&self) -> ToolDefinition {
        definition()
    }
    fn admission(&self) -> ToolAdmission {
        ToolAdmission::Parallel
    }

    fn decode(&self, input: Value) -> Result<Self::Input, ToolResult> {
        let input: GuideInput = serde_json::from_value(input).map_err(|error| {
            ToolResult::text(format!("Error: invalid guide arguments: {error}"), true)
        })?;
        input
            .validate()
            .map_err(|error| ToolResult::text(format!("Error: {error}"), true))?;
        Ok(input)
    }

    fn permission_resources(
        &self,
        input: &Self::Input,
        services: ToolServices<'_>,
    ) -> Result<Vec<PermissionResource>, ToolResult> {
        let guide =
            crate::guide::bundled().map_err(|error| ToolResult::text(error.to_string(), true))?;
        let suffix = match input {
            GuideInput::Read {
                document_id,
                section_id,
                ..
            } => format!("/{document_id}#{}", section_id.as_deref().unwrap_or("*")),
            _ => String::new(),
        };
        let mut resource =
            PermissionResource::new(NAME, format!("pack:{}{suffix}", guide.fingerprint));
        // Headless workers/orchestrators have no interactive broker. Preserve
        // explicit Deny and fail closed on Ask just like imported capabilities.
        if services.runtime.permission_broker.is_none() {
            use crate::permissions::{PermissionBackend, PermissionEffect, PermissionPolicy};
            let policy = PermissionPolicy::for_backend(
                PermissionBackend::from_execution_backend(services.runtime.backend.as_ref()),
                services.runtime.permission_rules.iter().cloned(),
            );
            if policy.evaluate(std::slice::from_ref(&resource), &[]).effect
                != PermissionEffect::Allow
            {
                resource = resource.with_hard_denial(
                    "NAC Guide read denied or requires interactive approval without a broker",
                );
            }
        }
        Ok(vec![resource])
    }

    fn execute<'a>(
        &'a self,
        input: Self::Input,
        _services: ToolServices<'a>,
        _context: &'a ToolCallContext,
    ) -> BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            match retrieve(input) {
                Ok(value) => ToolResult::text(value.to_string(), false),
                Err(error) => ToolResult::text(json!({"status":"unavailable","detail":error.to_string(),"build_identity":nac_contracts::build_identity()}).to_string(), true),
            }
        })
    }
}

fn retrieve(input: GuideInput) -> anyhow::Result<Value> {
    let guide = crate::guide::bundled()?;
    if input
        .expected_fingerprint()
        .is_some_and(|expected| expected != guide.fingerprint)
    {
        return Ok(
            json!({"status":"version_mismatch","detail":"Reference belongs to another guide pack; refresh the installed index", "fingerprint":guide.fingerprint,"build_identity":nac_contracts::build_identity()}),
        );
    }
    let payload = match input {
        GuideInput::Manifest { .. } => {
            json!({"documents":guide.documents.iter().map(|doc| json!({"document_id":doc.document_id,"title":doc.title,"source_path":doc.source_path,"content_digest":doc.content_digest})).collect::<Vec<_>>() })
        }
        GuideInput::Index { query, limit, .. } => {
            let hits = guide.search(query.as_deref().unwrap_or(""), limit.unwrap_or(20))?;
            json!({"status":if hits.is_empty() {"unknown_topic"} else {"ok"},"hits":hits})
        }
        GuideInput::Read {
            document_id,
            section_id: Some(section_id),
            offset,
            max_bytes,
            ..
        } => json!(guide.read(
            &document_id,
            &section_id,
            offset.unwrap_or(0),
            max_bytes.unwrap_or(4000)
        )?),
        GuideInput::Read { document_id, .. } => {
            let doc = guide.document(&document_id)?;
            json!({"document_id":doc.document_id,"title":doc.title,"source_path":doc.source_path,"content_digest":doc.content_digest,"sections":doc.sections.iter().map(|section| json!({"section_id":section.section_id,"title":section.title,"total_bytes":section.text.len()})).collect::<Vec<_>>()})
        }
    };
    Ok(
        json!({"provenance":"first-party bundled NAC Guide","schema_version":guide.schema_version,"fingerprint":guide.fingerprint,"build_identity":nac_contracts::build_identity(),"result":payload}),
    )
}

#[cfg(test)]
#[path = "guide_tests.rs"]
mod tests;
