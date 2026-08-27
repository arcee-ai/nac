//! `cargo run -p nac-catalog-gen` — regenerate nac-core's checked-in model
//! catalog baseline from a live models.dev snapshot.
//!
//! Usage:
//!   cargo run -p nac-catalog-gen                       fetch live, write artifacts
//!   cargo run -p nac-catalog-gen -- --check            fetch live, diff vs checked-in (exit 1 on drift)
//!   cargo run -p nac-catalog-gen -- --input FILE       generate from a recorded api.json fixture
//!   cargo run -p nac-catalog-gen -- --output-dir DIR   write somewhere else
//!   cargo run -p nac-catalog-gen -- --url URL          override the snapshot URL (or MODELS_DEV_URL)
//!
//! Writes `catalog.json` + `catalog.manifest.json` into
//! `crates/nac-core/src/model/catalog/data/`. Both are checked in; nac-core
//! loads them with `include_str!`, so builds stay hermetic (`--locked`,
//! offline) and this tool is the only network touchpoint.

use anyhow::{bail, Context, Result};
use nac_catalog_gen as gen;
use std::path::PathBuf;
use std::time::Duration;

const OVERRIDES_TOML: &str = include_str!("../overrides.toml");

struct Options {
    input: Option<PathBuf>,
    check: bool,
    output_dir: Option<PathBuf>,
    url: Option<String>,
    save_raw: Option<PathBuf>,
}

fn parse_options() -> Result<Options> {
    let mut options = Options {
        input: None,
        check: false,
        output_dir: None,
        url: None,
        save_raw: None,
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--check" => options.check = true,
            "--input" => {
                options.input = Some(PathBuf::from(
                    args.next().context("--input requires a file path")?,
                ));
            }
            "--output-dir" => {
                options.output_dir = Some(PathBuf::from(
                    args.next().context("--output-dir requires a directory")?,
                ));
            }
            "--url" => options.url = Some(args.next().context("--url requires a URL")?),
            "--save-raw" => {
                options.save_raw = Some(PathBuf::from(
                    args.next().context("--save-raw requires a file path")?,
                ));
            }
            "--help" | "-h" => {
                println!("{}", env!("CARGO_PKG_DESCRIPTION"));
                println!(
                    "usage: nac-catalog-gen [--check] [--input FILE] [--output-dir DIR] [--url URL] [--save-raw FILE]"
                );
                std::process::exit(0);
            }
            other => bail!("unknown argument '{other}' (--help for usage)"),
        }
    }
    Ok(options)
}

fn default_output_dir() -> PathBuf {
    // CARGO_MANIFEST_DIR = crates/nac-catalog-gen
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../nac-core/src/model/catalog/data")
}

async fn fetch(url: &str) -> Result<(String, Option<String>)> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .context("building HTTP client")?;
    let response = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("fetching {url}"))?;
    let status = response.status();
    if !status.is_success() {
        bail!("fetching {url}: HTTP {status}");
    }
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(std::string::ToString::to_string);
    let body = response.text().await.context("reading response body")?;
    Ok((body, etag))
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let options = parse_options()?;
    let url = options
        .url
        .or_else(|| std::env::var("MODELS_DEV_URL").ok())
        .unwrap_or_else(|| gen::MODELS_DEV_URL.to_string());

    let (api_json, etag, source) = match &options.input {
        Some(path) => {
            let body = std::fs::read_to_string(path)
                .with_context(|| format!("reading fixture {}", path.display()))?;
            (body, None, path.display().to_string())
        }
        None => {
            let (body, etag) = fetch(&url).await?;
            if let Some(path) = &options.save_raw {
                // Record the exact payload fetched (the test fixture is
                // trimmed from this file), so the golden test and the
                // checked-in artifacts always derive from one snapshot.
                std::fs::write(path, &body)
                    .with_context(|| format!("writing raw snapshot {}", path.display()))?;
                println!("saved raw snapshot to {}", path.display());
            }
            (body, etag, url.clone())
        }
    };

    let generation = gen::generate(&api_json, OVERRIDES_TOML)?;
    let manifest = gen::manifest(
        &generation.catalog,
        &generation.catalog_json,
        &source,
        etag.clone(),
    );
    let manifest_json = gen::manifest_json(&manifest)?;

    // Regen-time review summary.
    println!("source: {source}");
    if let Some(etag) = &etag {
        println!("models.dev etag: {etag}");
    }
    for (provider, doc) in &generation.catalog.providers {
        let replaced = generation
            .seed_maps_replaced
            .get(provider)
            .copied()
            .unwrap_or(0);
        println!(
            "  {provider}: {} models (thinking-level seeds replaced by curated matrix overrides: {replaced})",
            doc.models.len()
        );
        match &doc.default_base_url {
            Some(url) => println!("    default_base_url: {url}"),
            None => println!("    default_base_url: (none)"),
        }
    }
    for note in &generation.notes {
        println!("note: {note}");
    }

    let output_dir = options.output_dir.unwrap_or_else(default_output_dir);
    let catalog_path = output_dir.join("catalog.json");
    let manifest_path = output_dir.join("catalog.manifest.json");

    if options.check {
        let checked_in = std::fs::read_to_string(&catalog_path)
            .with_context(|| format!("reading {}", catalog_path.display()))?;
        let checked_manifest = std::fs::read_to_string(&manifest_path)
            .with_context(|| format!("reading {}", manifest_path.display()))?;
        let catalog_matches = checked_in == generation.catalog_json;
        // A fixture run cannot reproduce live-fetch provenance (URL/ETag);
        // inherit those fields from the checked-in manifest so --check
        // validates generated content, not the recording source.
        let mut expected_manifest = manifest;
        if options.input.is_some() {
            if let Ok(checked) = serde_json::from_str::<gen::ManifestDoc>(&checked_manifest) {
                expected_manifest.models_dev_url = checked.models_dev_url;
                expected_manifest.models_dev_etag = checked.models_dev_etag;
            }
        }
        let manifest_result = gen::check_manifest(&checked_manifest, &expected_manifest);
        if catalog_matches && manifest_result.is_ok() {
            println!("check: checked-in catalog.json and catalog.manifest.json are up to date");
            return Ok(());
        }
        if !catalog_matches {
            eprintln!("check: checked-in catalog.json differs from a fresh generation ({} vs {} bytes) — review with a regen", checked_in.len(), generation.catalog_json.len());
        }
        if let Err(error) = manifest_result {
            eprintln!("check: {error:#}");
        }
        std::process::exit(1);
    }

    std::fs::create_dir_all(&output_dir)
        .with_context(|| format!("creating {}", output_dir.display()))?;
    std::fs::write(&catalog_path, &generation.catalog_json)
        .with_context(|| format!("writing {}", catalog_path.display()))?;
    std::fs::write(&manifest_path, &manifest_json)
        .with_context(|| format!("writing {}", manifest_path.display()))?;
    println!(
        "wrote {} ({} bytes, sha256 {})",
        catalog_path.display(),
        generation.catalog_json.len(),
        manifest.sha256
    );
    println!("wrote {}", manifest_path.display());
    Ok(())
}
