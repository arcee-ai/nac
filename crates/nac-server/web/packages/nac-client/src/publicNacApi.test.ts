import { describe, expect, it, vi } from "vitest";
import { NacClient } from "./nacClient.js";
import { createPublicNacApi, type PublicNacPresentationSource } from "./publicNacApi.js";

// These transport fixtures contain no numeric prices; production uses the caller's schema codecs.
const source: PublicNacPresentationSource = {
  contract: "public-native-v1",
  decoders: {
    uiConfiguration: JSON.parse,
    modelCatalog: JSON.parse,
    modelConfigs: JSON.parse,
    projects: JSON.parse,
    sessions: JSON.parse,
    sessionConfig: JSON.parse,
  },
};

describe("additive public native reads", () => {
  it("fails before I/O when an old transport cannot honor the selected codec", () => {
    const client = new NacClient({ fetch: vi.fn() });
    const oldTransport = new Proxy(client.transport, {
      get: (target, key, receiver) =>
        key === "jsonResponseDecodingVersion" ? undefined : Reflect.get(target, key, receiver),
    });
    expect(() => createPublicNacApi(new NacClient(oldTransport), source)).toThrow(
      "response codec support",
    );
  });

  it("delivers original number lexemes to the caller codec without prior JSON rounding", async () => {
    const text = '{"price":0.123456789012345678901234567890}';
    const response = new Response(text, { headers: { "Content-Type": "application/json" } });
    const json = vi.spyOn(response, "json");
    const decoded = { catalog_version: "1", providers: [] };
    const decoder = vi.fn().mockReturnValue(decoded);
    const api = createPublicNacApi(new NacClient({ fetch: vi.fn().mockResolvedValue(response) }), {
      ...source,
      decoders: { ...source.decoders, modelCatalog: decoder },
    });
    expect(await api.getModelCatalog()).toBe(decoded);
    expect(decoder).toHaveBeenCalledExactlyOnceWith(text);
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    new Response(null, { status: 204 }),
    new Response("catalog", { headers: { "Content-Type": "text/plain" } }),
  ])("refuses a body that cannot use the selected JSON codec", async (response) => {
    const api = createPublicNacApi(
      new NacClient({ fetch: vi.fn().mockResolvedValue(response) }),
      source,
    );
    await expect(api.getModelCatalog()).rejects.toThrow("Expected a JSON response");
  });
  it("uses only the frozen public paths and preserves array response shapes", async () => {
    const calls: { method?: string; url: string; body?: BodyInit | null }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      calls.push({ method: init?.method, url: String(input), body: init?.body });
      return Response.json([]);
    });
    const api = createPublicNacApi(new NacClient({ endpoint: "/admitted/native", fetch }), source);
    await api.getUiConfiguration();
    await api.getModelCatalog();
    expect(await api.listModelConfigs()).toEqual([]);
    expect(await api.listProjects()).toEqual([]);
    await api.listSessions({ projectId: "project/one", workspaceStats: false });
    await api.getSessionConfig("session/one");
    expect(calls.map((call) => call.url)).toEqual([
      "/admitted/native/public/ui-config",
      "/admitted/native/public/models",
      "/admitted/native/public/model-configs",
      "/admitted/native/public/projects",
      "/admitted/native/public/sessions?project_id=project%2Fone&workspace_stats=false",
      "/admitted/native/public/sessions/session%2Fone/config",
    ]);
    expect(calls.every((call) => call.method === "GET" && call.body === undefined)).toBe(true);
  });

  it("uses the existing transport's fresh credentials and abort signal", async () => {
    let generation = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${generation}`);
      expect(init?.signal).toBe(controller.signal);
      return Response.json([]);
    });
    const controller = new AbortController();
    const api = createPublicNacApi(
      new NacClient({
        endpoint: "/admitted/native",
        headers: () => ({ Authorization: `Bearer ${++generation}` }),
        fetch,
      }),
      source,
    );
    await api.listSessions({}, controller.signal);
    await api.listProjects(controller.signal);
    expect(generation).toBe(2);
  });

  it("keeps omitted thresholds distinct from an entitled unset threshold", async () => {
    const config = {
      session_id: "session",
      model: "model",
      reasoning_effort: null,
      config_version: "9223372036854775807",
      light_model: null,
      provider_kind: null,
      diagnostic_codes: [],
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(config))
      .mockResolvedValueOnce(Response.json({ ...config, orchestrator_compaction_threshold: null }));
    const api = createPublicNacApi(new NacClient({ fetch }), source);
    const unentitled = await api.getSessionConfig("session");
    const unset = await api.getSessionConfig("session");
    expect("orchestrator_compaction_threshold" in unentitled).toBe(false);
    expect(unset.orchestrator_compaction_threshold).toBeNull();
    expect(unentitled.config_version).toBe("9223372036854775807");
    expect(Object.keys(unentitled)).not.toContain("base_url");
    expect(Object.keys(unentitled)).not.toContain("api_key_env");
  });
});
