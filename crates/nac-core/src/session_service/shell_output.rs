//! Pages address the redacted retained stream, never raw secret byte offsets.
//! Redacting the complete bounded artifact before slicing prevents a credential
//! from being disclosed one page at a time across an arbitrary boundary.
use super::*;
use crate::terminal::OutputStream;

const OUTPUT_UNAVAILABLE: &str =
    "Full retained output is unavailable; only safely redacted previews are recorded.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ShellOutputPage {
    pub content: String,
    pub offset: u64,
    pub next_offset: u64,
    pub eof: bool,
    pub overflowed: bool,
}

impl SessionService {
    pub(super) async fn enrich_shell_result_output(
        &self,
        command: &mut ShellCommandSnapshot,
        runtime: &crate::tools::ToolRuntime,
    ) {
        // Native tool results are JSON. Decode first, then apply the captured
        // output policy to the actual fields: escaped credential controls can
        // otherwise become literal again on decoding. Never fall back to raw
        // artifact bytes or to a failed preview sanitizer.
        let output_id = command.output_id.as_deref().unwrap_or("");
        let mut preview_unavailable = false;
        for preview in [&mut command.stdout, &mut command.stderr] {
            match runtime.redact_output(output_id, preview) {
                Ok(text) => *preview = text.chars().take(4_000).collect(),
                Err(_) => {
                    preview.clear();
                    preview_unavailable = true;
                }
            }
        }
        let Some(output_id) = command.output_id.clone() else {
            if preview_unavailable && command.diagnostic.is_none() {
                command.diagnostic = Some(OUTPUT_UNAVAILABLE.into());
            }
            return;
        };
        let runtime = runtime.clone();
        #[cfg(test)]
        let mut runtime = runtime;
        #[cfg(test)]
        let fault = take_enrichment_fault(&command.request_id);
        #[cfg(test)]
        match fault {
            Some(EnrichmentFault::Missing) => runtime.terminal_manager.remove_all().await.unwrap(),
            Some(EnrichmentFault::Redaction) => {
                runtime
                    .command_redactions
                    .lock()
                    .unwrap()
                    .remove(&output_id);
                runtime.command_environment = Some(Arc::new(UnavailableRedaction));
            }
            _ => {}
        }
        let output = tokio::task::spawn_blocking(move || {
            #[cfg(test)]
            if matches!(fault, Some(EnrichmentFault::Join)) {
                panic!("artifact enrichment join fault");
            }
            (
                redacted_artifact(&runtime, &output_id, OutputStream::Stdout),
                redacted_artifact(&runtime, &output_id, OutputStream::Stderr),
            )
        })
        .await;
        let mut unavailable = false;
        match output {
            Ok((stdout, stderr)) => {
                for (result, preview) in
                    [(stdout, &mut command.stdout), (stderr, &mut command.stderr)]
                {
                    match result {
                        Ok(Some((text, _))) => *preview = text.chars().take(4_000).collect(),
                        Ok(None) | Err(_) => unavailable = true,
                    }
                }
            }
            Err(_) => unavailable = true,
        }
        if unavailable {
            // Error details may themselves contain secrets or private paths.
            // State/exit/previews retain the known native result and its lease.
            command.diagnostic = Some(OUTPUT_UNAVAILABLE.into());
        }
    }

    pub async fn shell_command_output(
        &self,
        request_id: &str,
        stream: &str,
        offset: u64,
        limit: usize,
    ) -> Result<Option<ShellOutputPage>> {
        anyhow::ensure!(
            (1..=65_536).contains(&limit),
            "output limit must be between 1 and 65536"
        );
        let stream = OutputStream::parse(Some(stream))?;
        let Some(command) = self.lookup_shell_command(request_id).await? else {
            return Ok(None);
        };
        // A settled one-shot artifact is immutable. Live output has no stable
        // redacted cursor yet; the bounded preview appears after settlement.
        if !command.state.is_terminal() {
            return Ok(None);
        }
        let Some(output_id) = command.output_id else {
            return Ok(None);
        };
        let Some(runtime) = self.shell_runtime.clone() else {
            return Ok(None);
        };
        tokio::task::spawn_blocking(move || -> Result<Option<ShellOutputPage>> {
            let Some((masked, overflowed)) = redacted_artifact(&runtime, &output_id, stream)?
            else {
                return Ok(None);
            };
            let mut start = usize::try_from(offset)
                .unwrap_or(usize::MAX)
                .min(masked.len());
            while !masked.is_char_boundary(start) {
                start -= 1;
            }
            let mut end = start.saturating_add(limit).min(masked.len());
            while !masked.is_char_boundary(end) {
                end += 1;
            }
            Ok(Some(ShellOutputPage {
                content: masked[start..end].into(),
                offset: start as u64,
                next_offset: end as u64,
                eof: end == masked.len(),
                overflowed,
            }))
        })
        .await?
    }
}

#[cfg(test)]
#[derive(Clone, Copy)]
pub(super) enum EnrichmentFault {
    Missing,
    Redaction,
    Join,
}
#[cfg(test)]
static ENRICHMENT_FAULTS: std::sync::LazyLock<
    StdMutex<std::collections::HashMap<String, EnrichmentFault>>,
> = std::sync::LazyLock::new(|| StdMutex::new(std::collections::HashMap::new()));
#[cfg(test)]
pub(super) fn fail_enrichment_for_test(request_id: String, fault: EnrichmentFault) {
    ENRICHMENT_FAULTS.lock().unwrap().insert(request_id, fault);
}
#[cfg(test)]
fn take_enrichment_fault(request_id: &str) -> Option<EnrichmentFault> {
    ENRICHMENT_FAULTS.lock().unwrap().remove(request_id)
}
#[cfg(test)]
struct UnavailableRedaction;
#[cfg(test)]
impl nac_contracts::CommandEnvironmentProvider for UnavailableRedaction {
    fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
        Box::pin(async { anyhow::bail!("artifact-enrichment-private-error-canary") })
    }
    fn redaction_snapshot(&self) -> Result<nac_contracts::CommandEnvironmentSnapshot> {
        anyhow::bail!("artifact-enrichment-private-error-canary")
    }
    fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
        Default::default()
    }
}

pub(super) fn redacted_artifact(
    runtime: &crate::tools::ToolRuntime,
    output_id: &str,
    stream: OutputStream,
) -> Result<Option<(String, bool)>> {
    let mut cursor = 0;
    let mut retained = String::new();
    let mut overflowed = false;
    loop {
        let page = match runtime
            .terminal_manager
            .read_output(output_id, stream, cursor, 65_536)
        {
            Ok(page) => page,
            Err(_) => return Ok(None),
        };
        overflowed |= page.overflowed;
        retained.push_str(&page.content);
        anyhow::ensure!(
            retained.len() <= 64 * 1024 * 1024,
            "retained output exceeds paging budget"
        );
        if page.eof {
            break;
        }
        anyhow::ensure!(
            page.next_offset > cursor,
            "retained output cursor did not advance"
        );
        cursor = page.next_offset;
    }
    Ok(Some((
        runtime.redact_output(output_id, &retained)?,
        overflowed,
    )))
}
