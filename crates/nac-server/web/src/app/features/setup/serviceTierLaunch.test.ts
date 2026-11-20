import { expect, it } from "vitest";
import { configuredSessionRequest } from "@/app/features/home/modelChoice";

it("distinguishes an explicit provider-default clear from an omitted tier when Home creates a session", () => {
  const selected = {
    kind: "resolved",
    backend: "chatgpt-codex-responses",
    model: "example",
    base_url: "https://chatgpt.com/backend-api",
    allow_insecure_http: false,
    api_key_env: null,
    reasoning_effort: "high",
    extra_headers: null,
    light_model: null,
  } as const;
  const home = {
    policy: { orchestrationEnabled: false },
    projectId: "project",
    behavior: "direct",
    selected,
    light: null,
  } as Parameters<typeof configuredSessionRequest>[0];
  expect(configuredSessionRequest(home)).not.toHaveProperty("service_tier");
  expect(
    configuredSessionRequest({ ...home, selected: { ...selected, service_tier: null } }),
  ).toHaveProperty("service_tier", null);
});
