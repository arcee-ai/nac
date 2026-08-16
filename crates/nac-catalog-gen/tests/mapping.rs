//! Synthetic-fixture tests for the models.dev → catalog mapping rules and
//! the curated-override mechanism: schema drift fails loudly, fallbacks and
//! clamps hold, and the matrix transcription applies exactly.

use nac_catalog_gen as gen;

const EMPTY_OVERRIDES: &str = "";

/// Minimal api.json with one model per provider; extra providers are
/// ignored (the top level parses tolerantly).
fn api_json(anthropic_models: &str, deepseek_models: &str) -> String {
    format!(
        r#"{{
          "unrelated-provider": {{"models": {{"anything-goes": {{"totally": "drifted"}}}}}},
          "anthropic": {{"models": {{{anthropic_models}}}}},
          "deepseek": {{"models": {{{deepseek_models}}}}},
          "fireworks-ai": {{"models": {{}}}},
          "togetherai": {{"models": {{}}}},
          "openai": {{"models": {{}}}}
        }}"#
    )
}

fn one_model(extra: &str) -> String {
    api_json(
        &format!(
            r#""claude-test-1": {{
              "id": "claude-test-1", "name": "Claude Test", "reasoning": true,
              "limit": {{"context": 200000, "output": 64000}},
              "cost": {{"input": 3, "output": 15, "cache_read": 0.3, "cache_write": 3.75}}
              {extra}
            }}"#
        ),
        "",
    )
}

fn generate(api_json: &str, overrides: &str) -> gen::Generation {
    gen::generate(api_json, overrides).expect("synthetic fixture generates")
}

fn only_model(generation: &gen::Generation) -> &gen::ModelDoc {
    generation.catalog.providers["anthropic-messages"]
        .models
        .values()
        .next()
        .expect("one model")
}

#[test]
fn seed_mapping_toggle_effort_and_budget_tokens() {
    let generation = generate(
        &one_model(
            r#", "reasoning_options": [
              {"type": "toggle"},
              {"type": "effort", "values": ["low", "medium", "high", "max"]},
              {"type": "budget_tokens", "min": 1024}
            ]"#,
        ),
        EMPTY_OVERRIDES,
    );
    let map = &only_model(&generation).thinking_level_map;
    assert_eq!(map.get("none").unwrap().as_deref(), Some("none"));
    assert_eq!(map.get("low").unwrap().as_deref(), Some("low"));
    assert_eq!(map.get("medium").unwrap().as_deref(), Some("medium"));
    assert_eq!(map.get("high").unwrap().as_deref(), Some("high"));
    // `max` without `xhigh` collapses into nac's xhigh slot (Anthropic/
    // DeepSeek convention: the top wire tier is `max` but maps to xhigh).
    assert_eq!(map.get("xhigh").unwrap().as_deref(), Some("max"));
    assert_eq!(
        map.len(),
        5,
        "budget_tokens contributes no entries: {map:?}"
    );
}

#[test]
fn seed_mapping_max_and_xhigh_get_separate_slots_when_both_listed() {
    let generation = generate(
        &one_model(
            r#", "reasoning_options": [
              {"type": "effort", "values": ["xhigh", "max"]}
            ]"#,
        ),
        EMPTY_OVERRIDES,
    );
    let map = &only_model(&generation).thinking_level_map;
    // When both are listed, each gets its own nac effort slot (OpenAI
    // GPT-5.6: xhigh and max are distinct tiers).
    assert_eq!(map.get("xhigh").unwrap().as_deref(), Some("xhigh"));
    assert_eq!(map.get("max").unwrap().as_deref(), Some("max"));
    assert_eq!(map.len(), 2);

    let reversed = generate(
        &one_model(
            r#", "reasoning_options": [
              {"type": "effort", "values": ["max", "xhigh"]}
            ]"#,
        ),
        EMPTY_OVERRIDES,
    );
    assert_eq!(
        only_model(&reversed)
            .thinking_level_map
            .get("xhigh")
            .unwrap()
            .as_deref(),
        Some("xhigh"),
        "order-independent: both tiers get their own slots"
    );
    assert_eq!(
        only_model(&reversed)
            .thinking_level_map
            .get("max")
            .unwrap()
            .as_deref(),
        Some("max"),
        "order-independent: both tiers get their own slots"
    );
}

#[test]
fn seed_mapping_null_effort_value_means_no_effort() {
    // models.dev encodes the no-effort tier as a bare null (seen 2026-08-02).
    let generation = generate(
        &one_model(
            r#", "reasoning_options": [
              {"type": "effort", "values": [null, "low"]}
            ]"#,
        ),
        EMPTY_OVERRIDES,
    );
    let map = &only_model(&generation).thinking_level_map;
    assert_eq!(map.get("none").unwrap().as_deref(), Some("none"));
    assert_eq!(map.get("low").unwrap().as_deref(), Some("low"));
}

#[test]
fn seed_mapping_missing_limit_and_cost_fall_back() {
    let generation = generate(&one_model(""), EMPTY_OVERRIDES);
    let model = only_model(&generation);
    // limit/cost present in `one_model`; remove them for the real check.
    let sparse = generate(
        &api_json(
            r#""m-1": {"id": "m-1", "name": "M", "reasoning": false}"#,
            "",
        ),
        EMPTY_OVERRIDES,
    );
    let sparse = only_model(&sparse);
    assert_eq!(sparse.context_window, gen::FALLBACK_CONTEXT_WINDOW);
    assert_eq!(sparse.max_tokens, gen::FALLBACK_MAX_TOKENS);
    assert_eq!(
        (
            sparse.cost.input,
            sparse.cost.output,
            sparse.cost.cache_read,
            sparse.cost.cache_write
        ),
        (0.0, 0.0, 0.0, 0.0)
    );
    assert!(!sparse.reasoning);
    assert!(sparse.thinking_level_map.is_empty());
    assert_eq!(model.context_window, 200_000);
    assert_eq!(model.max_tokens, 64_000);
}

#[test]
fn seed_mapping_zero_limits_fall_back_and_output_clamps_to_context() {
    let generation = generate(
        &api_json(
            r#""m-zero": {"id": "m-zero", "limit": {"context": 0, "output": 0}}"#,
            "",
        ),
        EMPTY_OVERRIDES,
    );
    let zero = only_model(&generation);
    assert_eq!(zero.context_window, gen::FALLBACK_CONTEXT_WINDOW);
    assert_eq!(zero.max_tokens, gen::FALLBACK_MAX_TOKENS);

    let clamped = generate(
        &api_json(
            r#""m-clamp": {"id": "m-clamp", "limit": {"context": 1000, "output": 5000}}"#,
            "",
        ),
        EMPTY_OVERRIDES,
    );
    let clamped = only_model(&clamped);
    assert_eq!(clamped.context_window, 1_000);
    assert_eq!(clamped.max_tokens, 1_000, "max_tokens clamps to the window");
}

#[test]
fn unknown_reasoning_option_type_fails_loudly() {
    let result = gen::generate(
        &one_model(r#", "reasoning_options": [{"type": "telepathy"}]"#),
        EMPTY_OVERRIDES,
    );
    let error = format!("{:#}", result.unwrap_err());
    assert!(error.contains("unknown reasoning_options"), "{error}");
    assert!(error.contains("claude-test-1"), "{error}");
}

#[test]
fn unknown_effort_value_fails_loudly() {
    let result = gen::generate(
        &one_model(r#", "reasoning_options": [{"type": "effort", "values": ["ultra"]}]"#),
        EMPTY_OVERRIDES,
    );
    let error = format!("{:#}", result.unwrap_err());
    assert!(error.contains("unknown effort value 'ultra'"), "{error}");
}

#[test]
fn negative_cost_rate_fails_loudly() {
    let result = gen::generate(
        &api_json(r#""m-neg": {"id": "m-neg", "cost": {"input": -1}}"#, ""),
        EMPTY_OVERRIDES,
    );
    let error = format!("{:#}", result.unwrap_err());
    assert!(error.contains("negative input rate"), "{error}");
}

#[test]
fn cost_tiers_map_context_steps_and_fill_omitted_buckets_from_base() {
    let generation = generate(
        &api_json(
            r#""claude-tiered": {
              "id": "claude-tiered", "name": "Claude Tiered", "reasoning": false,
              "limit": {"context": 1000000, "output": 64000},
              "cost": {
                "input": 3, "output": 15, "cache_read": 0.3, "cache_write": 3.75,
                "tiers": [
                  {"tier": {"type": "context", "size": 200000}, "input": 6, "output": 22.5}
                ]
              }
            }"#,
            "",
        ),
        EMPTY_OVERRIDES,
    );
    let cost = &only_model(&generation).cost;
    assert_eq!(cost.input, 3.0);
    let tiers = cost.tiers.as_ref().expect("tier mapped");
    assert_eq!(tiers.len(), 1);
    assert_eq!(tiers[0].input_tokens_above, 200_000);
    assert_eq!(tiers[0].input, 6.0);
    assert_eq!(tiers[0].output, 22.5);
    assert_eq!(tiers[0].cache_read, 0.3, "omitted bucket fills from base");
    assert_eq!(tiers[0].cache_write, 3.75, "omitted bucket fills from base");
}

#[test]
fn unknown_cost_tier_type_fails_loudly() {
    let result = gen::generate(
        &api_json(
            r#""m-tier": {"id": "m-tier", "cost": {"input": 1, "tiers": [
              {"tier": {"type": "time_of_day", "size": 1000}, "input": 2}
            ]}}"#,
            "",
        ),
        EMPTY_OVERRIDES,
    );
    let error = format!("{:#}", result.unwrap_err());
    assert!(error.contains("unknown cost tier type 'time_of_day'"), "{error}");
}

#[test]
fn negative_tier_rate_fails_loudly() {
    let result = gen::generate(
        &api_json(
            r#""m-tier-neg": {"id": "m-tier-neg", "cost": {"input": 1, "tiers": [
              {"tier": {"type": "context", "size": 1000}, "output": -2}
            ]}}"#,
            "",
        ),
        EMPTY_OVERRIDES,
    );
    let error = format!("{:#}", result.unwrap_err());
    assert!(error.contains("negative output rate"), "{error}");
}

#[test]
fn missing_mapped_provider_fails_loudly() {
    let result = gen::generate(
        r#"{"deepseek": {"models": {}}, "fireworks-ai": {"models": {}},
           "togetherai": {"models": {}}, "openai": {"models": {}}}"#,
        EMPTY_OVERRIDES,
    );
    let error = format!("{:#}", result.unwrap_err());
    assert!(error.contains("provider 'anthropic' is missing"), "{error}");
}

#[test]
fn provider_env_maps_the_first_conventional_var_name() {
    let payload = r#"{
      "anthropic": {"env": ["ANTHROPIC_API_KEY", "ANTHROPIC_ALT_KEY"], "models": {}},
      "deepseek": {"env": ["DEEPSEEK_API_KEY"], "models": {}},
      "fireworks-ai": {"models": {}},
      "togetherai": {"env": [], "models": {}},
      "openai": {"env": ["OPENAI_API_KEY"], "models": {}}
    }"#;
    let generation = generate(payload, EMPTY_OVERRIDES);
    let var = |provider: &str| {
        generation.catalog.providers[provider]
            .credential_env_var
            .as_deref()
    };
    // The first entry is the conventional name.
    assert_eq!(var("anthropic-messages"), Some("ANTHROPIC_API_KEY"));
    assert_eq!(var("deepseek-chat"), Some("DEEPSEEK_API_KEY"));
    assert_eq!(var("openai-responses"), Some("OPENAI_API_KEY"));
    // Missing and empty `env` lists map to None (no conventional name).
    assert_eq!(var("fireworks-chat"), None);
    assert_eq!(var("together-chat"), None);
}

#[test]
fn invalid_credential_env_var_fails_loudly() {
    for env in [
        r#"["not a valid name!!"]"#,
        r#"["  "]"#,
        r#"["1STARTS_WITH_DIGIT"]"#,
    ] {
        let payload = format!(
            r#"{{"anthropic": {{"models": {{}}}}, "deepseek": {{"env": {env}, "models": {{}}}},
               "fireworks-ai": {{"models": {{}}}}, "togetherai": {{"models": {{}}}},
               "openai": {{"models": {{}}}}}}"#
        );
        let result = gen::generate(&payload, EMPTY_OVERRIDES);
        let error = format!("{:#}", result.unwrap_err());
        assert!(
            error.contains("invalid credential env var name"),
            "{env}: {error}"
        );
    }
}

#[test]
fn provider_default_override_replaces_every_seed_map() {
    let overrides = r#"
        [providers."anthropic-messages"]
        default_thinking_levels = { none = "none" }
    "#;
    let generation = generate(
        &one_model(
            r#", "reasoning_options": [
              {"type": "effort", "values": ["low", "medium", "high", "max"]}
            ]"#,
        ),
        overrides,
    );
    let map = &only_model(&generation).thinking_level_map;
    assert_eq!(map.len(), 1);
    assert_eq!(map.get("none").unwrap().as_deref(), Some("none"));
    assert_eq!(generation.seed_maps_replaced["anthropic-messages"], 1);
}

#[test]
fn model_override_applies_to_dated_snapshot_family_members() {
    let overrides = r#"
        [providers."anthropic-messages"]
        default_thinking_levels = { none = "none" }
        [providers."anthropic-messages".models."claude-opus-9-9"]
        thinking_levels = { none = "none", low = "low", xhigh = "max" }
    "#;
    let generation = generate(
        &api_json(
            r#""claude-opus-9-9": {"id": "claude-opus-9-9", "reasoning": true},
                "claude-opus-9-9-20270101": {"id": "claude-opus-9-9-20270101", "reasoning": true},
                "claude-opus-9-9-latest": {"id": "claude-opus-9-9-latest", "reasoning": true}"#,
            "",
        ),
        overrides,
    );
    let models = &generation.catalog.providers["anthropic-messages"].models;
    let family = models["claude-opus-9-9"].thinking_level_map.clone();
    assert_eq!(family.get("xhigh").unwrap().as_deref(), Some("max"));
    assert_eq!(
        models["claude-opus-9-9-20270101"].thinking_level_map, family,
        "dated snapshots inherit the family override"
    );
    assert_eq!(
        models["claude-opus-9-9-latest"].thinking_level_map.len(),
        1,
        "non-dated suffixes are not family members and keep the provider default"
    );
}

#[test]
fn unmatched_override_is_a_review_note_not_an_error() {
    let overrides = r#"
        [providers."anthropic-messages".models."claude-nonexistent"]
        thinking_levels = { none = "none" }
    "#;
    let generation = generate(&one_model(""), overrides);
    assert!(
        generation
            .notes
            .iter()
            .any(|note| note.contains("claude-nonexistent")
                && note.contains("matched no models.dev entry")),
        "{:?}",
        generation.notes
    );
}

#[test]
fn overrides_reject_unknown_providers_efforts_and_empty_wires() {
    for (overrides, expected) in [
        (
            r#"[providers."not-a-provider"]"#,
            "unknown provider 'not-a-provider'",
        ),
        (
            r#"[providers."deepseek-chat"]
               default_thinking_levels = { ultra = "ultra" }"#,
            "unknown effort level 'ultra'",
        ),
        (
            r#"[providers."deepseek-chat"]
               default_thinking_levels = { high = "" }"#,
            "empty wire value for effort 'high'",
        ),
    ] {
        let result = gen::generate(&one_model(""), overrides);
        let error = format!("{:#}", result.unwrap_err());
        assert!(error.contains(expected), "{error} (expected '{expected}')");
    }
}

#[test]
fn unrelated_providers_with_drifted_schemas_are_ignored() {
    // The top level parses tolerantly; only nac's five providers are
    // strictly decoded, so drift elsewhere cannot break regeneration.
    let generation = generate(&one_model(""), EMPTY_OVERRIDES);
    assert!(!generation
        .catalog
        .providers
        .contains_key("unrelated-provider"));
}

#[test]
fn non_agent_models_are_filtered() {
    let generation = generate(
        &api_json(
            r#""good":{"tool_call":true,"modalities":{"input":["text"],"output":["text"]}},"deprecated":{"status":"deprecated","tool_call":true},"embedding":{"family":"text-embedding","tool_call":false},"image":{"family":"gpt-image","modalities":{"output":["image"]}},"realtime":{"tool_call":true,"modalities":{"input":["text","audio"],"output":["text","audio"]}}"#,
            "",
        ),
        EMPTY_OVERRIDES,
    );
    assert_eq!(
        generation.catalog.providers["anthropic-messages"]
            .models
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        ["good"]
    );
}

#[test]
fn final_override_numeric_invariants_are_validated() {
    for (overrides, expected) in [
        (
            r#"[providers."anthropic-messages".models."claude-test-1"]
context_window=32000"#,
            "max_tokens 64000",
        ),
        (
            r#"[providers."anthropic-messages".models."claude-test-1"]
max_tokens=0"#,
            "must be positive",
        ),
        (
            r#"[providers."anthropic-messages".models."claude-test-1"]
cost={input=-1,output=1,cache_read=0,cache_write=0}"#,
            "finite and nonnegative",
        ),
    ] {
        let error = format!(
            "{:#}",
            gen::generate(&one_model(""), overrides).unwrap_err()
        );
        assert!(error.contains(expected), "{error}");
    }
}

#[test]
fn provider_api_maps_to_default_base_url_with_normalization() {
    // models.dev `api` → default_base_url; trailing slashes are stripped
    // (nac's adapters append their own paths).
    let payload = r#"{
      "anthropic": {"models": {}},
      "deepseek": {"api": "https://api.deepseek.com", "models": {}},
      "fireworks-ai": {"api": "https://api.fireworks.ai/inference/v1/", "models": {}},
      "togetherai": {"models": {}},
      "openai": {"models": {}}
    }"#;
    let generation = generate(payload, EMPTY_OVERRIDES);
    let providers = &generation.catalog.providers;
    assert_eq!(
        providers["deepseek-chat"].default_base_url.as_deref(),
        Some("https://api.deepseek.com")
    );
    assert_eq!(
        providers["fireworks-chat"].default_base_url.as_deref(),
        Some("https://api.fireworks.ai/inference/v1"),
        "trailing slash stripped"
    );
    // Providers without models.dev `api` and without an override get none.
    assert_eq!(providers["anthropic-messages"].default_base_url, None);
    assert_eq!(providers["openai-responses"].default_base_url, None);
    assert_eq!(providers["together-chat"].default_base_url, None);
}

#[test]
fn override_default_base_url_wins_and_is_normalized() {
    let payload = r#"{
      "anthropic": {"models": {}},
      "deepseek": {"api": "https://api.deepseek.com", "models": {}},
      "fireworks-ai": {"models": {}},
      "togetherai": {"models": {}},
      "openai": {"models": {}}
    }"#;
    let overrides = r#"
        [providers."anthropic-messages"]
        default_base_url = " https://api.anthropic.com/ "
        [providers."deepseek-chat"]
        default_base_url = "https://curated.example/v1"
    "#;
    let generation = generate(payload, overrides);
    let providers = &generation.catalog.providers;
    assert_eq!(
        providers["anthropic-messages"].default_base_url.as_deref(),
        Some("https://api.anthropic.com"),
        "whitespace and the trailing slash are normalized away"
    );
    assert_eq!(
        providers["deepseek-chat"].default_base_url.as_deref(),
        Some("https://curated.example/v1"),
        "the curated table wins over models.dev api"
    );
}

#[test]
fn invalid_default_base_urls_fail_loudly() {
    let with_api = |api: &str| {
        format!(
            r#"{{
              "anthropic": {{"models": {{}}}},
              "deepseek": {{"api": "{api}", "models": {{}}}},
              "fireworks-ai": {{"models": {{}}}},
              "togetherai": {{"models": {{}}}},
              "openai": {{"models": {{}}}}
            }}"#
        )
    };
    for (api, expected) in [
        ("not a url", "invalid api base URL"),
        ("ftp://api.deepseek.com", "absolute http(s) URL with a host"),
        ("https://", "invalid api base URL"),
    ] {
        let result = gen::generate(&with_api(api), EMPTY_OVERRIDES);
        let error = format!("{:#}", result.unwrap_err());
        assert!(error.contains(expected), "{error} (expected '{expected}')");
    }

    let result = gen::generate(
        &one_model(""),
        r#"[providers."anthropic-messages"]
           default_base_url = "not a url""#,
    );
    let error = format!("{:#}", result.unwrap_err());
    assert!(
        error.contains("providers.anthropic-messages.default_base_url"),
        "{error}"
    );
}
