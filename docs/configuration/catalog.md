# Catalog and cost

NAC ships an embedded model catalog generated from [models.dev](https://models.dev): per-model context windows, maximum output tokens, pricing per 1M tokens, and supported reasoning effort levels for the `deepseek-chat`, `fireworks-chat`, `together-chat`, `openai-responses`, and `anthropic-messages` backends (`arcee-auth`/`arcee-api` and `chatgpt-codex-responses` entries are maintained by hand). Effort validation, Anthropic `max_tokens`, and per-response cost all read this catalog. Each provider also carries a conventional credential variable name and an endpoint default base URL, which drive credential auto-selection and absent-`base_url` materialization; a configured model id resolves its provider through the catalog (unique exact match; collisions prefer the non-managed provider with a warning). A model the catalog does not know resolves from its provider's default entry with conservative fallbacks (128k context, 16k max output, zero cost), so unknown models keep working.

At startup, `nac-web` spawns a fire-and-forget background refresh that revalidates the catalog against models.dev with the stored ETag, at most once every 4 hours. A changed payload is mapped into `$NAC_HOME/model-catalog/overlay.json` (atomic write) and loaded over the embedded baseline; a `304` defers the next check, and any failure leaves the cached overlay and baseline untouched and retries on the next start. The refresh never blocks model calls, and resolution, picker, resume, and validation paths never perform network I/O — offline operation always works from the cached overlay and the embedded baseline. A corrupt overlay, or one older than the embedded baseline, is ignored with a warning. `MODELS_DEV_URL` can point the refresh at a mirror.

Per-deployment overrides live in `$NAC_HOME/models.json` (`~/.config/nac/models.json` by default):

```json
{
  "overrides": [
    {
      "provider": "anthropic-messages",
      "model": "claude-haiku-4-5",
      "set": { "thinking_level_map": { "none": "none", "high": "high" } }
    },
    {
      "provider": "openai-responses",
      "model": "my-local-model",
      "set": { "context_window": 262144, "max_tokens": 32768 }
    }
  ]
}
```

- `provider` is a backend id; `model` is an exact model id, or `_default` to patch the provider-wide fallback entry. An unknown id derives its base metadata from the dated-snapshot family entry or the provider default before patching, so overriding a model the catalog does not know yet — for example one served by a custom `base_url` — is the supported self-unblock path.
- `set` accepts `display_name`, `context_window`, `max_tokens`, `cost` (`input`/`output`/`cache_read`/`cache_write` per 1M tokens, plus an optional `tiers` list), `cache_write_1h`, `reasoning`, and `thinking_level_map`. The wire protocol (`api`) and adapter quirks (`compat`) are not patchable. Omitted `cost` buckets keep their resolved rates. A `cost` patch without `tiers` keeps the entry's existing tiers; an explicit `"tiers": []` clears them. Buckets a tier omits fill from the resulting merged base rates, so partial tiers stay complete rate sets.
- `thinking_level_map` replaces the model's whole effort map; keys are effort levels (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`) and values are provider wire values. This is how effort validation is relaxed per model — the first override above lets `claude-haiku-4-5` accept `high`.
- Precedence is user overrides over the runtime overlay over the embedded baseline over the provider default over the fallback. A malformed file degrades to a warning with the baseline still usable; invalid entries are skipped individually with warnings.

Every model response carries a catalog-rate cost estimate in its token usage, computed as `tokens × rate` per input/output/cache-read/cache-write bucket (micro-USD, rounded half-up per response). Reasoning tokens bill at the output rate as `max(output_tokens, reasoning_tokens) × rate`: exact for providers that include reasoning in their output count (the OpenAI convention), and still capturing reasoning for a provider that excludes it. Models with context-dependent pricing carry `cost.tiers` (from models.dev): when a response's prompt size — input plus cache read plus cache write — exceeds a tier's `input_tokens_above`, the highest matching tier's rates apply to the whole response. Anthropic 1-hour cache writes bill at the `cache_write_1h` rate (default 2× the input rate); unknown pricing bills zero rather than failing. Cost rides in the `TokenUsageUpdated` event's `usage.cost` and accumulates into the session's persisted token accounting. The dashboard shows it in the session bar's tokens metric (cumulative cost appended to the token counts), in that metric's tooltip (a per-bucket breakdown plus the last response's cost), and in each worker's token-usage panel (a Cost row). Unknown pricing renders as `—`, never `$0.00`. For managed `chatgpt-codex-responses`, this is an API-equivalent estimate using catalog rates, not a provider invoice or evidence of an incremental per-token charge to the ChatGPT account.

Session-backed OpenAI Responses and managed Codex requests reuse the session UUID as `prompt_cache_key`; Codex also sends the same value in its session-affinity headers. GPT-5.6-family API requests use an explicit breakpoint after the stable leading system instructions and disable the moving implicit breakpoint, so changing conversation history does not repeatedly write the stable prefix. Anthropic keeps explicit tool, system, current-user, and prior-user boundaries; the prior-user boundary preserves a hit when a parallel tool round exceeds Anthropic's 20-block lookback. Provider-reported cache reads and writes remain separate usage and cost buckets.

## Model selection in the dashboard

The launch dialog and the session settings panel pick models from a searchable combobox: entries grouped by provider, each row showing the display name, model id, context window, and per-1M pricing (`pricing unknown` when the catalog has no rates). The reasoning dropdown is constrained to the selected model's supported effort levels and hidden when the model accepts none; an unrecognized model assumes its provider's default effort list, flagged as assumed and validated by the backend on submit. A persistent "Custom model…" option enters an arbitrary model id on a chosen provider for endpoints the catalog does not know. Selections the catalog does not recognize carry an `unrecognized model — conservative defaults` badge; models patched by `$NAC_HOME/models.json` carry a `customized` badge. If the catalog cannot be loaded, both surfaces fall back to manual backend and model entry with a notice.

`GET /models` serves the listing as `{ catalog_version, providers }`. Each provider carries its auth requirement (`api_key_env`, `managed_arcee`, or `codex_oauth`), a per-request `auth_status` (`ready` or `no_credential`) with an `auth_hint` (the conventional credential env var name or the login command), any managed base URL, the catalog endpoint default base URL, the provider default limits (context window, max output, default effort list), and its model entries with per-model limits, pricing, and supported efforts. `catalog_version` is a monotonic counter bumped on every catalog reload.

A provider with no usable credential gets a `no credential detected` badge in the picker, with the fix path in the tooltip (set the named environment variable or choose a custom selector; run the login command for managed providers). The status is computed per request from the server process environment and the managed credential files; it is informational only — it never blocks selection and never changes how auth works.

The launch dialog's collapsed `overrides` disclosure holds the per-session endpoint overrides: base url, API key variable, and extra headers (a JSON object). Empty fields do nothing — the normal config resolution applies; filled fields override the configured values for the new session, with a filled extra-headers field replacing the configured map. The base url and API key variable fields hide for managed backends, which need neither.

The `compaction threshold (tokens)` field auto-suggests 70% of the selected model's context window in whole tokens on every picker model change, in both the launch dialog and the settings panel; the field stays editable, and a manually entered value is preserved across model changes — the auto-suggest only fills the field when it is empty or was itself last auto-suggested.
