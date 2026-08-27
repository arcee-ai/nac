//! Export the exact OpenAPI document assembled by nac-server's HTTP adapter.

use std::path::PathBuf;

use anyhow::{bail, Context, Result};

fn main() -> Result<()> {
    let mut args = std::env::args_os().skip(1).peekable();
    let check = args.next_if(|argument| argument == "--check").is_some();
    let Some(output) = args.next() else {
        bail!("usage: export-openapi [--check] OUTPUT");
    };
    if args.next().is_some() {
        bail!("usage: export-openapi [--check] OUTPUT");
    }

    let output = PathBuf::from(output);
    let document = nac_server::openapi_document();
    let mut json = serde_json::to_string_pretty(&document).context("serializing OpenAPI")?;
    json.push('\n');

    if check {
        let existing = std::fs::read_to_string(&output)
            .with_context(|| format!("reading {}", output.display()))?;
        if existing != json {
            bail!(
                "{} is stale; run the API contract generator",
                output.display()
            );
        }
        println!("{} is current", output.display());
        return Ok(());
    }

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    std::fs::write(&output, json).with_context(|| format!("writing {}", output.display()))?;
    println!("wrote {}", output.display());
    Ok(())
}
