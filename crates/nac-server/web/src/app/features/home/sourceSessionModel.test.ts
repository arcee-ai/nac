import { describe, expect, it } from "vitest";
import type {
  ManagedSessionSummary,
  ProjectRecord,
  ProjectSessionModelSource,
} from "@/app/types/api";
import { eligibleSource, sourceSelection } from "./sourceSessionModel";

const project = {
  project_id: "p",
  cwd: "/repo",
  ssh_host: null,
  ssh_port: null,
  ssh_identity_file: null,
} as ProjectRecord;
const source = {
  summary: {
    session_id: "s",
    project_id: "p",
    cwd: "/repo",
    ssh_host: null,
    sandboxed: false,
    backend: "openai-responses",
  },
  lineage: null,
} as ManagedSessionSummary;
const config = {
  session_id: "s",
  backend: "openai-responses",
  model: "gpt-6.1-sol",
  base_url: "https://api.openai.com/v1",
  allow_insecure_http: false,
  api_key_env: "OPENAI_API_KEY",
  reasoning_effort: "high",
  service_tier: "fast",
} as ProjectSessionModelSource;

describe("source session selection", () => {
  it("binds the full saved model route and tier to the same session", () => {
    expect(eligibleSource(source, project)).toBe(true);
    expect(sourceSelection(config, source)?.selection).toMatchObject({
      backend: "openai-responses",
      model: "gpt-6.1-sol",
      base_url: "https://api.openai.com/v1",
      api_key_env: "OPENAI_API_KEY",
      reasoning_effort: "high",
      service_tier: "fast",
      extra_headers: null,
    });
    expect(sourceSelection({ ...config, session_id: "other" }, source)).toBeNull();
  });
  it("excludes other projects, descendants, sandbox, changed paths and remote identities", () => {
    for (const entry of [
      { ...source, summary: { ...source.summary, project_id: "other" } },
      { ...source, lineage: {} },
      { ...source, summary: { ...source.summary, sandboxed: true } },
      { ...source, summary: { ...source.summary, cwd: "/other" } },
      { ...source, summary: { ...source.summary, ssh_host: "other" } },
      {
        ...source,
        summary: { ...source.summary, model_config_error: "invalid" },
      },
    ] as ManagedSessionSummary[])
      expect(eligibleSource(entry, project)).toBe(false);
  });
  it("fails closed on unknown routes, diagnostics and unsupported tiers", () => {
    expect(sourceSelection({ ...config, backend: "unknown" }, source)).toBeNull();
    expect(sourceSelection({ ...config, backend: null }, source)).toBeNull();
    expect(
      sourceSelection({ ...config, diagnostics: ["Invalid source model configuration"] }, source),
    ).toBeNull();
    expect(sourceSelection({ ...config, service_tier: "unknown" }, source)).toBeNull();
  });
});
