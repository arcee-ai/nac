import { describe, expect, it } from "vitest";

import { serializeExtraHeaders } from "@/app/lib/modelConfig";

describe("serializeExtraHeaders", () => {
  it("rejects object values with the field-specific validation error", () => {
    expect(() => serializeExtraHeaders('{"X-Test":{"toString":null}}', {})).toThrow(
      'Extra Headers value for "X-Test" must be a string',
    );
  });
});

import {
  buildSettingsPatch,
  type ModelFormValues,
  type SettingsInitialValues,
} from "@/app/lib/modelConfig";
import type { ManagedHostStatus } from "@/app/types/api";

it("saves a managed model change only for the ready host credential destination", () => {
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
  const host: Pick<ManagedHostStatus, "model" | "model_ready"> = {
    model_ready: true,
    model: {
      backend: "arcee-api",
      id: initial.model,
      endpoint: initial.base_url,
      display_name: "Arcee",
    },
  };
  expect(buildSettingsPatch(values, initial, host)).toEqual({ model: values.model });
  for (const status of [null, { ...host, model_ready: false }]) {
    expect(() => buildSettingsPatch(values, initial, status)).toThrow("requires an API key");
  }
  for (const changed of [
    { ...values, backend: "openai-responses" },
    { ...values, base_url: "https://api.arcee.ai/other" },
  ]) {
    expect(() => buildSettingsPatch(changed, initial, host)).toThrow("requires an API key");
  }
});
