//! Pages address the redacted retained stream, never raw secret byte offsets.
//! Redacting the complete bounded artifact before slicing prevents a credential
//! from being disclosed one page at a time across an arbitrary boundary.
use super::*;
use crate::terminal::OutputStream;

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
