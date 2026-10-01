import { describe, expect, it } from "vitest";

import {
  buildSettingsPatch,
  serializeExtraHeaders,
  type ModelFormValues,
  type SettingsInitialValues,
} from "@/app/lib/modelConfig";

describe("serializeExtraHeaders", () => {
  it("rejects object values with the field-specific validation error", () => {
    expect(() => serializeExtraHeaders('{"X-Test":{"toString":null}}', {})).toThrow(
      'Extra Headers value for "X-Test" must be a string',
    );
  });
});

it("accepts a credentialless API-key selection only with an explicit caller capability", () => {
  const initial: SettingsInitialValues = {
    model: "trinity-large-thinking",
    backend: "arcee-api",
    base_url: "https://api.arcee.ai/api/v1",
    allow_insecure_http: false,
    api_key_env: null,
    reasoning_effort: null,
    extra_headers: {},
    orchestrator_compaction_threshold: null,
  };
  const values: ModelFormValues = {
    ...initial,
    model: "moonshotai/kimi-k3",
    api_key_env: "",
    credential_mode: "none",
    reasoning_effort: "",
    extra_headers: "",
    orchestrator_compaction_threshold: "",
  };
  expect(buildSettingsPatch(values, initial, true)).toEqual({ model: values.model });
  expect(() => buildSettingsPatch(values, initial)).toThrow("requires an API key");
});

it("emits the insecure HTTP acknowledgement only when it changes", () => {
  const initial: SettingsInitialValues = {
    model: "custom-model",
    backend: "openai-responses",
    base_url: "http://gateway.example/v1",
    allow_insecure_http: false,
    api_key_env: "OPENAI_API_KEY",
    reasoning_effort: null,
    extra_headers: {},
    orchestrator_compaction_threshold: null,
  };
  const values: ModelFormValues = {
    ...initial,
    allow_insecure_http: true,
    api_key_env: "OPENAI_API_KEY",
    credential_mode: "variable",
    reasoning_effort: "",
    extra_headers: "",
    orchestrator_compaction_threshold: "",
  };
  expect(buildSettingsPatch(values, initial)).toEqual({ allow_insecure_http: true });
});

it("preserves the exact accepted OAuth route and explicit headers instead of resetting the account endpoint", () => {
  const initial: SettingsInitialValues = {
    backend: "chatgpt-codex-responses",
    model: "gpt-5.6-sol",
    base_url: "https://chatgpt.com/backend-api/codex",
    allow_insecure_http: false,
    api_key_env: null,
    reasoning_effort: "high",
    extra_headers: { "X-Account": "chosen-account" },
    orchestrator_compaction_threshold: null,
  };
  expect(
    buildSettingsPatch(
      {
        ...initial,
        reasoning_effort: "high",
        credential_mode: "none",
        api_key_env: "",
        extra_headers: '{"X-Account":"chosen-account"}',
        orchestrator_compaction_threshold: "",
      },
      initial,
    ),
  ).toEqual({});
});
