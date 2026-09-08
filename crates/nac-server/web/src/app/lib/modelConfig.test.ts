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
