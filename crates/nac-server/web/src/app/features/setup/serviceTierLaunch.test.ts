import { expect, it } from "vitest";
import { projectChatRequest } from "./projectLaunch";
import { configuredSessionRequest } from "@/app/features/home/modelChoice";

it("distinguishes an explicit provider-default clear from an omitted tier in both launch paths", () => {
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
  const base = {
    projectId: "project",
    selected,
    policy: { orchestrationEnabled: false },
    behavior: "direct",
    reasoning: "",
    headers: undefined,
    compaction: "",
    automaticCompaction: false,
    presetCompaction: false,
    savedLight: null,
    light: { mode: "single", light: null },
    execution: "ssh",
    sandbox: { noMount: false, image: "", gpu: "", workdir: "", shm: "", mounts: "" },
    activityKey: null,
  } as Parameters<typeof projectChatRequest>[0];
  expect(projectChatRequest(base)).not.toHaveProperty("service_tier");
  expect(
    projectChatRequest({ ...base, selected: { ...selected, service_tier: null } }),
  ).toHaveProperty("service_tier", null);
  const home = {
    policy: base.policy,
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
