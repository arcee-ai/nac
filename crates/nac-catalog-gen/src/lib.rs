//! nac-catalog-gen: generate nac-core's checked-in model catalog baseline.
//!
//! Pipeline: read models.dev `api.json` (fetched live by the binary, or a
//! recorded fixture in tests) → extract nac's five models.dev providers →
//! map each model to a seed entry (`limit` → context/max-tokens with the
//! 128k/16k fallbacks, `cost` → rates, `reasoning_options` → thinking-level
//! seeds, provider `env` → the conventional credential variable name, which
//! is status-only metadata for the `/models` auth hint and never changes
//! how auth works) → apply the curated `overrides.toml` (which replicates
//! the pre-S4 `backend.rs` effort-validation matrix exactly; validation now
//! reads these maps) → emit `catalog.json` + `catalog.manifest.json`.
//!
//! The output is checked in and loaded by nac-core via `include_str!`; no
//! build-time or runtime network exists anywhere outside this tool.
//!
//! Working fetch URL (verified 2026-08-02): `https://models.dev/api.json`.
//! If that ever becomes unreachable, a jsDelivr mirror of the models.dev
//! GitHub repo works as a fallback:
//! `https://cdn.jsdelivr.net/gh/sst/models.dev@<commit>/packages/models.dev/src/assets/api.json`
//! (override with `--url` or `MODELS_DEV_URL`).

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Canonical models.dev snapshot endpoint.
pub const MODELS_DEV_URL: &str = "https://models.dev/api.json";

/// Context-window fallback for models with no usable models.dev limit (pi's
/// 128k default); mirrors nac-core's `catalog::FALLBACK_CONTEXT_WINDOW`.
pub const FALLBACK_CONTEXT_WINDOW: u64 = 128_000;
/// Max-output fallback; mirrors nac-core's `catalog::FALLBACK_MAX_TOKENS`.
pub const FALLBACK_MAX_TOKENS: u64 = 16_384;

/// models.dev provider id → nac `BackendKind` kebab id. Arcee and
/// chatgpt-codex-responses are not models.dev providers; their catalog data
/// stays hand-written in nac-core's seed module.
pub const PROVIDER_MAP: [(&str, &str); 5] = [
    ("deepseek", "deepseek-chat"),
    ("fireworks-ai", "fireworks-chat"),
    ("togetherai", "together-chat"),
    ("openai", "openai-responses"),
    ("anthropic", "anthropic-messages"),
];

/// Effort levels nac knows, in `ReasoningEffort` serde (lowercase) form.
pub const EFFORT_NAMES: [&str; 7] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// ---------------------------------------------------------------------------
// models.dev input schema (strict where drift matters, tolerant elsewhere)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct ModelsDevProvider {
    /// Conventional credential environment variable names (status-only
    /// metadata for the `/models` auth hint); the first entry is the
    /// conventional name. Absent for providers models.dev does not key by
    /// env var.
    env: Option<Vec<String>>,
    /// Provider endpoint base URL (`api` in models.dev). Carried only for
    /// providers whose SDK has no implicit default endpoint (deepseek and
    /// fireworks-ai in the current snapshot); anthropic/openai/togetherai
    /// omit it and are hand-seeded via `overrides.toml`.
    api: Option<String>,
    models: BTreeMap<String, ModelsDevModel>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevModel {
    name: Option<String>,
    family: Option<String>,
    status: Option<String>,
    tool_call: Option<bool>,
    modalities: Option<ModelsDevModalities>,
    reasoning: Option<bool>,
    reasoning_options: Option<Vec<ReasoningOption>>,
    limit: Option<ModelsDevLimit>,
    cost: Option<ModelsDevCost>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevModalities {
    input: Option<Vec<String>>,
    output: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevLimit {
    context: Option<u64>,
    output: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevCost {
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
    tiers: Option<Vec<ModelsDevCostTier>>,
    // models.dev also carries a separate `reasoning` rate for some models
    // (e.g. deepseek); reasoning-token pricing is intentionally not mapped
    // (S3 bills reasoning at the output rate, opencode-style).
}

/// models.dev `cost.tiers[]` entry. Only `tier.type == "context"` is
/// mapped; anything else is schema drift and a hard error at regen time.
#[derive(Debug, Deserialize)]
struct ModelsDevCostTier {
    tier: ModelsDevTierSelector,
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevTierSelector {
    #[serde(rename = "type")]
    kind: String,
    size: u64,
}

/// Thinking-control dialects models.dev knows about. Unknown variants are a
/// hard error: schema drift must fail loudly at regen time, not silently
/// drop thinking controls.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ReasoningOption {
    /// Reasoning can be toggled on/off; off maps to the `none` effort.
    Toggle,
    /// Explicit effort tiers, named by their provider wire values. models.dev
    /// uses a bare `null` for the no-effort tier (seen in the wild on
    /// 2026-08-02, e.g. sarvam); it seeds the `none` effort.
    Effort { values: Vec<Option<String>> },
    /// Anthropic-style manual thinking budget; not an effort level, so it
    /// contributes no map entries (the `reasoning` flag still records it).
    BudgetTokens {},
    #[serde(other)]
    Unknown,
}

// ---------------------------------------------------------------------------
// Emitted catalog document (the JSON contract nac-core deserializes)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostDoc {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
    /// Context-priced rate steps (models.dev `cost.tiers`), complete per
    /// bucket (omitted buckets filled from the base rates). Absent = flat
    /// pricing. Deserialized by nac-core as `ModelCostRates::tiers`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiers: Option<Vec<CostTierDoc>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostTierDoc {
    pub input_tokens_above: u64,
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelDoc {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    pub context_window: u64,
    pub max_tokens: u64,
    pub cost: CostDoc,
    pub reasoning: bool,
    #[serde(default)]
    pub image_input: bool,
    /// Effort level (nac `ReasoningEffort` lowercase serde name) → provider
    /// wire value. Present + null = explicitly unsupported; absent =
    /// unsupported. nac-core deserializes this as `ThinkingLevelMap`.
    pub thinking_level_map: BTreeMap<String, Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderDoc {
    /// The provider's conventional credential environment variable name
    /// (models.dev `env`'s first entry). Status-only metadata: nac's auth
    /// model stays the explicit `api_key_env` selector; this only powers
    /// the `/models` auth-status hint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_env_var: Option<String>,
    /// Default endpoint base URL for the provider: models.dev `api`, or the
    /// curated `overrides.toml` value for the SDK-default providers.
    /// Normalized (trimmed, no trailing slash). nac-core fills a genuinely
    /// absent request `base_url` with it; managed providers carry no
    /// default (their canonical URLs stay code-side) and never appear in
    /// this document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_base_url: Option<String>,
    pub models: BTreeMap<String, ModelDoc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatalogDoc {
    pub providers: BTreeMap<String, ProviderDoc>,
}

/// Sidecar manifest; nac-core tests recompute `sha256` over the embedded
/// `catalog.json` bytes to pin the pair together.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ManifestDoc {
    pub sha256: String,
    /// UTC ISO-8601 generation time.
    pub generated_at: String,
    pub models_dev_url: String,
    /// HTTP ETag of the fetched snapshot, verbatim (S2's overlay refresh
    /// revalidates with it). `None` when generated from a recorded fixture.
    pub models_dev_etag: Option<String>,
    pub model_counts: BTreeMap<String, usize>,
}

// ---------------------------------------------------------------------------
// Curated overrides (overrides.toml)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
pub struct OverridesDoc {
    #[serde(default)]
    providers: BTreeMap<String, ProviderOverride>,
}

#[derive(Debug, Default, Deserialize)]
struct ProviderOverride {
    /// Replaces the models.dev-derived seed map for every model of the
    /// provider. This is how the `backend.rs` matrix stays authoritative:
    /// every provider's default here transcribes its matrix row exactly.
    default_thinking_levels: Option<BTreeMap<String, String>>,
    /// Hand-seeded endpoint default for providers models.dev does not key
    /// by `api` (the SDK-default providers). Wins over models.dev `api`
    /// when both exist — the curated table stays authoritative.
    default_base_url: Option<String>,
    #[serde(default)]
    models: BTreeMap<String, ModelOverride>,
}

#[derive(Debug, Default, Deserialize)]
struct ModelOverride {
    /// Replaces the seed map for this model and its dated snapshots
    /// (`name-YYYYMMDD`, nac-core's `catalog::dated_snapshot_family` rule).
    thinking_levels: Option<BTreeMap<String, String>>,
    reasoning: Option<bool>,
    display_name: Option<String>,
    context_window: Option<u64>,
    max_tokens: Option<u64>,
    cost: Option<CostDoc>,
}

impl OverridesDoc {
    fn validate(&self) -> Result<()> {
        let known: Vec<&str> = PROVIDER_MAP.iter().map(|(_, nac)| *nac).collect();
        for (provider, provider_override) in &self.providers {
            if !known.contains(&provider.as_str()) {
                bail!(
                    "overrides.toml: unknown provider '{provider}' (expected one of: {})",
                    known.join(", ")
                );
            }
            if let Some(levels) = &provider_override.default_thinking_levels {
                validate_levels(levels).with_context(|| {
                    format!("overrides.toml: providers.{provider}.default_thinking_levels")
                })?;
            }
            if let Some(url) = &provider_override.default_base_url {
                normalize_base_url(url).with_context(|| {
                    format!("overrides.toml: providers.{provider}.default_base_url")
                })?;
            }
            for (model, model_override) in &provider_override.models {
                if model.trim().is_empty() {
                    bail!("overrides.toml: providers.{provider}.models has an empty model id");
                }
                if let Some(levels) = &model_override.thinking_levels {
                    validate_levels(levels).with_context(|| {
                        format!("overrides.toml: providers.{provider}.models.{model}")
                    })?;
                }
            }
        }
        Ok(())
    }
}

fn validate_levels(levels: &BTreeMap<String, String>) -> Result<()> {
    for (effort, wire) in levels {
        if !EFFORT_NAMES.contains(&effort.as_str()) {
            bail!(
                "unknown effort level '{effort}' (expected one of: {})",
                EFFORT_NAMES.join(", ")
            );
        }
        if wire.trim().is_empty() {
            bail!("empty wire value for effort '{effort}'");
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Seed mapping (models.dev → pre-override entry)
// ---------------------------------------------------------------------------

/// models.dev `api` / curated override → the provider's default base URL.
/// The curated override wins when both exist (the table stays
/// authoritative, as with the thinking-level matrix). Values are
/// normalized and must be absolute http(s) URLs with a host; drift fails
/// loudly at regen time.
fn provider_default_base_url(
    models_dev_id: &str,
    api: Option<&str>,
    provider_override: Option<&ProviderOverride>,
) -> Result<Option<String>> {
    let curated = provider_override
        .and_then(|provider_override| provider_override.default_base_url.as_deref());
    let Some(raw) = curated.or(api) else {
        return Ok(None);
    };
    normalize_base_url(raw)
        .with_context(|| {
            format!("models.dev provider '{models_dev_id}': invalid api base URL '{raw}'")
        })
        .map(Some)
}

/// Trim, strip trailing slashes, and require an absolute http(s) URL with a
/// host. Shared by the models.dev `api` mapping and `overrides.toml`
/// validation so both sources emit byte-identical values.
fn normalize_base_url(url: &str) -> Result<String> {
    let trimmed = url.trim().trim_end_matches('/');
    let parsed = reqwest::Url::parse(trimmed).context("not a valid absolute URL")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        bail!("must be an absolute http(s) URL with a host");
    }
    Ok(trimmed.to_string())
}

/// Map models.dev's provider `env` list to the conventional credential
/// variable name (the first entry). Missing/empty lists yield `None`
/// (providers not keyed by env var); a present but malformed name is a hard
/// error — schema drift in a consumed field fails loudly at regen time.
fn seed_credential_env_var(provider: &str, env: Option<&[String]>) -> Result<Option<String>> {
    let Some(first) = env.and_then(|env| env.first()) else {
        return Ok(None);
    };
    let name = first.trim();
    if !is_valid_env_name(name) {
        bail!(
            "models.dev provider '{provider}': invalid credential env var name {first:?} \
             (models.dev schema drift — extend the generator deliberately)"
        );
    }
    Ok(Some(name.to_string()))
}

/// `[A-Za-z_][A-Za-z0-9_]*`; mirrors nac-core's `backend.rs` env-name rule.
fn is_valid_env_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z' | b'a'..=b'z' | b'_'))
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

/// Map `reasoning_options` to thinking-level seeds. Wire values map to
/// nac effort slots by name; `max` gets its own `max` slot when the model
/// also lists `xhigh` (OpenAI GPT-5.6), or collapses into the `xhigh` slot
/// when `xhigh` is absent (Anthropic/DeepSeek, where `max` is the wire
/// value for nac's xhigh tier).
fn seed_thinking_levels(
    provider: &str,
    model: &str,
    options: Option<&[ReasoningOption]>,
) -> Result<BTreeMap<String, Option<String>>> {
    let mut map: BTreeMap<String, Option<String>> = BTreeMap::new();
    let Some(options) = options else {
        return Ok(map);
    };
    for option in options {
        match option {
            ReasoningOption::Toggle => {
                map.entry("none".to_string())
                    .or_insert_with(|| Some("none".to_string()));
            }
            ReasoningOption::BudgetTokens {} => {}
            ReasoningOption::Unknown => bail!(
                "models.dev provider '{provider}' model '{model}': unknown reasoning_options \
                 entry type (models.dev schema drift — extend the generator deliberately)"
            ),
            ReasoningOption::Effort { values } => {
                for value in values {
                    // models.dev encodes the no-effort tier as a bare null.
                    let wire = value.as_deref().unwrap_or("none");
                    let effort = match wire {
                        "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" => wire,
                        other => bail!(
                            "models.dev provider '{provider}' model '{model}': unknown effort \
                             value '{other}' (models.dev schema drift — extend the generator \
                             deliberately)"
                        ),
                    };
                    map.insert(effort.to_string(), Some(wire.to_string()));
                }
            }
        }
    }
    // If `max` is present but `xhigh` is not, `max` is the wire value for
    // nac's xhigh slot (Anthropic/DeepSeek convention: the top tier is
    // called `max` on the wire but maps to nac's xhigh effort). Move it
    // so the seed map matches the curated override structure.
    if map.contains_key("max") && !map.contains_key("xhigh") {
        let wire = map.remove("max").flatten();
        map.insert("xhigh".to_string(), wire);
    }
    Ok(map)
}

/// `limit.context`/`limit.output` → (context_window, max_tokens). Zero or
/// missing limits fall back to 128k/16k (pi's defaults); max_tokens is
/// clamped to the window so the catalog invariant holds by construction.
fn seed_limits(limit: Option<&ModelsDevLimit>) -> (u64, u64) {
    let context = limit
        .and_then(|limit| limit.context)
        .filter(|&context| context > 0)
        .unwrap_or(FALLBACK_CONTEXT_WINDOW);
    let output = limit
        .and_then(|limit| limit.output)
        .filter(|&output| output > 0)
        .unwrap_or(FALLBACK_MAX_TOKENS);
    (context, output.min(context))
}

fn seed_cost(provider: &str, model: &str, cost: Option<&ModelsDevCost>) -> Result<CostDoc> {
    let rate = |rate: Option<f64>, field: &str| -> Result<f64> {
        let rate = rate.unwrap_or(0.0);
        if !rate.is_finite() || rate < 0.0 {
            bail!(
                "models.dev provider '{provider}' model '{model}': negative {field} rate \
                 {rate} (models.dev schema drift)"
            );
        }
        Ok(rate)
    };
    let base = CostDoc {
        input: rate(cost.and_then(|cost| cost.input), "input")?,
        output: rate(cost.and_then(|cost| cost.output), "output")?,
        cache_read: rate(cost.and_then(|cost| cost.cache_read), "cache_read")?,
        cache_write: rate(cost.and_then(|cost| cost.cache_write), "cache_write")?,
        tiers: None,
    };
    let tier_rate = |tier_value: Option<f64>, base: f64, field: &str| -> Result<f64> {
        match tier_value {
            Some(_) => rate(tier_value, field),
            None => Ok(base),
        }
    };
    let mut tiers = Vec::new();
    for tier in cost.and_then(|cost| cost.tiers.as_deref()).unwrap_or(&[]) {
        if tier.tier.kind != "context" {
            bail!(
                "models.dev provider '{provider}' model '{model}': unknown cost tier type \
                 '{}' (models.dev schema drift)",
                tier.tier.kind
            );
        }
        tiers.push(CostTierDoc {
            input_tokens_above: tier.tier.size,
            input: tier_rate(tier.input, base.input, "input")?,
            output: tier_rate(tier.output, base.output, "output")?,
            cache_read: tier_rate(tier.cache_read, base.cache_read, "cache_read")?,
            cache_write: tier_rate(tier.cache_write, base.cache_write, "cache_write")?,
        });
    }
    let tiers = (!tiers.is_empty()).then_some(tiers);
    Ok(CostDoc { tiers, ..base })
}

fn is_agent_compatible(model: &ModelsDevModel) -> bool {
    if model.status.as_deref() == Some("deprecated") || model.tool_call == Some(false) {
        return false;
    }
    if model
        .family
        .as_deref()
        .is_some_and(|f| f.contains("embedding") || f.contains("image"))
    {
        return false;
    }
    let input = model
        .modalities
        .as_ref()
        .and_then(|m| m.input.as_ref())
        .is_none_or(|v| v.iter().any(|x| x == "text"));
    let output = model
        .modalities
        .as_ref()
        .and_then(|m| m.output.as_ref())
        .is_none_or(|v| v.as_slice() == ["text"]);
    input && output
}

fn validate_final_model(provider: &str, model: &str, entry: &ModelDoc) -> Result<()> {
    if entry.context_window == 0 {
        bail!("{provider}/{model}: context_window must be positive after overrides");
    }
    if entry.max_tokens == 0 || entry.max_tokens > entry.context_window {
        bail!("{provider}/{model}: max_tokens {} must be positive and <= context_window {} after overrides", entry.max_tokens, entry.context_window);
    }
    for (field, rate) in [
        ("input", entry.cost.input),
        ("output", entry.cost.output),
        ("cache_read", entry.cost.cache_read),
        ("cache_write", entry.cost.cache_write),
    ] {
        if !rate.is_finite() || rate < 0.0 {
            bail!("{provider}/{model}: {field} rate {rate} must be finite and nonnegative after overrides");
        }
    }
    for tier in entry.cost.tiers.as_deref().unwrap_or(&[]) {
        for (field, rate) in [
            ("input", tier.input),
            ("output", tier.output),
            ("cache_read", tier.cache_read),
            ("cache_write", tier.cache_write),
        ] {
            if !rate.is_finite() || rate < 0.0 {
                bail!("{provider}/{model}: tier {field} rate {rate} (above {} prompt tokens) must be finite and nonnegative after overrides", tier.input_tokens_above);
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Generation pipeline
// ---------------------------------------------------------------------------

/// Generator output: the catalog document, its exact serialized bytes,
/// per-provider counts of seed maps replaced by curated overrides, and
/// regen-time review notes (e.g. unmatched overrides).
#[derive(Debug)]
pub struct Generation {
    pub catalog: CatalogDoc,
    pub catalog_json: String,
    /// Per-provider count of models whose models.dev-derived seed map was
    /// replaced by the curated provider default — the regen-time review
    /// signal for "models.dev now claims different thinking levels than the
    /// matrix; consider relaxing overrides deliberately".
    pub seed_maps_replaced: BTreeMap<String, usize>,
    pub notes: Vec<String>,
}

/// Run the full map + override pipeline over a models.dev `api.json` payload.
///
/// The top level parses tolerantly and only nac's five providers are
/// strictly decoded, so schema drift in unrelated providers (models.dev
/// carries 150+) cannot break regeneration; drift inside a consumed
/// provider is a hard error.
pub fn generate(api_json: &str, overrides_toml: &str) -> Result<Generation> {
    let raw: BTreeMap<String, serde_json::Value> =
        serde_json::from_str(api_json).context("parsing models.dev api.json")?;
    let overrides: OverridesDoc =
        toml::from_str(overrides_toml).context("parsing overrides.toml")?;
    overrides.validate()?;

    let mut providers = BTreeMap::new();
    let mut seed_maps_replaced: BTreeMap<String, usize> = BTreeMap::new();
    let mut notes = Vec::new();
    let mut matched_overrides: Vec<(String, String)> = Vec::new();

    for (models_dev_id, nac_id) in PROVIDER_MAP {
        let Some(raw_provider) = raw.get(models_dev_id) else {
            bail!(
                "models.dev provider '{models_dev_id}' is missing from api.json (renamed or \
                 removed upstream — update PROVIDER_MAP deliberately)"
            );
        };
        let provider: ModelsDevProvider = serde_json::from_value(raw_provider.clone())
            .with_context(|| format!("decoding models.dev provider '{models_dev_id}'"))?;
        let provider_override = overrides.providers.get(nac_id);
        let default_base_url =
            provider_default_base_url(models_dev_id, provider.api.as_deref(), provider_override)?;
        let mut models = BTreeMap::new();
        for (id, model) in &provider.models {
            if !is_agent_compatible(model) {
                continue;
            }
            let seed_map =
                seed_thinking_levels(models_dev_id, id, model.reasoning_options.as_deref())?;
            let (context_window, max_tokens) = seed_limits(model.limit.as_ref());
            let mut entry = ModelDoc {
                display_name: model.name.clone(),
                context_window,
                max_tokens,
                cost: seed_cost(models_dev_id, id, model.cost.as_ref())?,
                reasoning: model.reasoning.unwrap_or(false),
                image_input: model
                    .modalities
                    .as_ref()
                    .and_then(|modalities| modalities.input.as_ref())
                    .is_some_and(|inputs| inputs.iter().any(|input| input == "image")),
                thinking_level_map: seed_map,
            };
            let seed_map = entry.thinking_level_map.clone();
            apply_overrides(
                nac_id,
                id,
                &mut entry,
                provider_override,
                &mut matched_overrides,
            );
            validate_final_model(nac_id, id, &entry)?;
            if entry.thinking_level_map != seed_map {
                *seed_maps_replaced.entry(nac_id.to_string()).or_insert(0) += 1;
            }
            models.insert(id.clone(), entry);
        }
        providers.insert(
            nac_id.to_string(),
            ProviderDoc {
                credential_env_var: seed_credential_env_var(
                    models_dev_id,
                    provider.env.as_deref(),
                )?,
                default_base_url,
                models,
            },
        );
    }

    // Review signal: curated entries that matched nothing this regen.
    for (provider, provider_override) in &overrides.providers {
        for model in provider_override.models.keys() {
            let matched = matched_overrides
                .iter()
                .any(|(matched_provider, matched_model)| {
                    matched_provider == provider && matched_model == model
                });
            if !matched {
                notes.push(format!(
                    "override {provider}/{model} matched no models.dev entry (stale curation?)"
                ));
            }
        }
    }

    let catalog = CatalogDoc { providers };
    let catalog_json =
        serde_json::to_string_pretty(&catalog).context("serializing catalog.json")? + "\n";
    Ok(Generation {
        catalog,
        catalog_json,
        seed_maps_replaced,
        notes,
    })
}

fn apply_overrides(
    provider: &str,
    id: &str,
    entry: &mut ModelDoc,
    provider_override: Option<&ProviderOverride>,
    matched: &mut Vec<(String, String)>,
) {
    let Some(provider_override) = provider_override else {
        return;
    };
    // The provider default replaces nearly every seed map by design (the
    // curated matrix, not models.dev reasoning_options, stays authoritative),
    // so replacements are not noted per-model; the binary prints a
    // per-provider replacement summary.
    if let Some(levels) = &provider_override.default_thinking_levels {
        entry.thinking_level_map = to_wire_map(levels);
    }
    let model_override = provider_override.models.get_key_value(id).or_else(|| {
        let family = dated_snapshot_family(id)?;
        provider_override.models.get_key_value(family)
    });
    if let Some((key, model_override)) = model_override {
        matched.push((provider.to_string(), key.clone()));
        if let Some(levels) = &model_override.thinking_levels {
            entry.thinking_level_map = to_wire_map(levels);
        }
        if let Some(reasoning) = model_override.reasoning {
            entry.reasoning = reasoning;
        }
        if let Some(display_name) = &model_override.display_name {
            entry.display_name = Some(display_name.clone());
        }
        if let Some(context_window) = model_override.context_window {
            entry.context_window = context_window;
        }
        if let Some(max_tokens) = model_override.max_tokens {
            entry.max_tokens = max_tokens;
        }
        if let Some(cost) = &model_override.cost {
            entry.cost = cost.clone();
        }
    }
}

fn to_wire_map(levels: &BTreeMap<String, String>) -> BTreeMap<String, Option<String>> {
    levels
        .iter()
        .map(|(effort, wire)| (effort.clone(), Some(wire.clone())))
        .collect()
}

/// Strip a `-YYYYMMDD` dated-snapshot suffix, mirroring nac-core's
/// `catalog::dated_snapshot_family` resolution rule.
fn dated_snapshot_family(model: &str) -> Option<&str> {
    let (base, snapshot) = model.rsplit_once('-')?;
    (snapshot.len() == 8 && snapshot.bytes().all(|byte| byte.is_ascii_digit())).then_some(base)
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

pub fn manifest(
    catalog: &CatalogDoc,
    catalog_json: &str,
    models_dev_url: &str,
    models_dev_etag: Option<String>,
) -> ManifestDoc {
    let model_counts = catalog
        .providers
        .iter()
        .map(|(provider, doc)| (provider.clone(), doc.models.len()))
        .collect();
    ManifestDoc {
        sha256: hex_sha256(catalog_json.as_bytes()),
        generated_at: utc_now_iso8601(),
        models_dev_url: models_dev_url.to_string(),
        models_dev_etag,
        model_counts,
    }
}

pub fn manifest_json(manifest: &ManifestDoc) -> Result<String> {
    Ok(serde_json::to_string_pretty(manifest).context("serializing manifest")? + "\n")
}

pub fn check_manifest(checked_json: &str, expected: &ManifestDoc) -> Result<()> {
    let checked: ManifestDoc =
        serde_json::from_str(checked_json).context("parsing checked-in catalog.manifest.json")?;
    if checked.sha256 != expected.sha256
        || checked.models_dev_url != expected.models_dev_url
        || checked.models_dev_etag != expected.models_dev_etag
        || checked.model_counts != expected.model_counts
    {
        bail!("checked-in catalog.manifest.json differs from fresh generation");
    }
    if !is_valid_utc_timestamp(&checked.generated_at) {
        bail!("checked-in catalog.manifest.json has malformed generated_at");
    }
    Ok(())
}

fn is_valid_utc_timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 20
        || !b[..4].iter().all(u8::is_ascii_digit)
        || b[4] != b'-'
        || !b[5..7].iter().all(u8::is_ascii_digit)
        || b[7] != b'-'
        || !b[8..10].iter().all(u8::is_ascii_digit)
        || b[10] != b'T'
        || !b[11..13].iter().all(u8::is_ascii_digit)
        || b[13] != b':'
        || !b[14..16].iter().all(u8::is_ascii_digit)
        || b[16] != b':'
        || !b[17..19].iter().all(u8::is_ascii_digit)
        || b[19] != b'Z'
    {
        return false;
    }
    let number =
        |range: std::ops::Range<usize>| std::str::from_utf8(&b[range]).ok()?.parse::<u32>().ok();
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
    ) else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    year != 0 && (1..=days).contains(&day) && hour < 24 && minute < 60 && second < 60
}

pub fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// UTC ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`) without a datetime dependency.
fn utc_now_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    format_unix_utc(secs)
}

/// Civil-from-days conversion (Howard Hinnant's algorithm).
fn format_unix_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hour, minute, second) = (rem / 3_600, (rem % 3_600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_utc_formats_known_timestamps() {
        assert_eq!(format_unix_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(format_unix_utc(86_399), "1970-01-01T23:59:59Z");
        assert_eq!(format_unix_utc(1_735_689_600), "2025-01-01T00:00:00Z");
        assert_eq!(format_unix_utc(1_767_225_600), "2026-01-01T00:00:00Z");
        // Leap day: 2024-02-29T12:00:00Z.
        assert_eq!(format_unix_utc(1_709_208_000), "2024-02-29T12:00:00Z");
    }

    #[test]
    fn dated_snapshot_family_matches_the_backend_rule() {
        assert_eq!(
            dated_snapshot_family("claude-opus-4-6-20260301"),
            Some("claude-opus-4-6")
        );
        assert_eq!(dated_snapshot_family("claude-opus-4-6-latest"), None);
        assert_eq!(dated_snapshot_family("claude-opus-4-6"), None);
    }
}
