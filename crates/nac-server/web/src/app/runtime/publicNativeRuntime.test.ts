import { afterEach, expect, it, vi } from "vitest";
import { createNacClient } from "../services/nacClient";
import { createNativeRuntime, type NativeRuntime } from "./nativeRuntime";
import type { PublicNacPresentationSource } from "../../../packages/nac-client/src/publicNacApi.js";

const scope = {
  owner: "owner",
  profile: "profile",
  organization: "organization",
  host: "host",
  incarnation: "incarnation",
  endpoint: "/admitted",
  release: "release",
};
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
const opened: NativeRuntime[] = [];
afterEach(() => {
  for (const runtime of opened.splice(0)) runtime.close();
});

it("uses the same lifetime-bound transport and never issues a read after closure", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([]));
  const runtime = createNativeRuntime({
    scope,
    client: createNacClient({ endpoint: scope.endpoint, fetch }),
    publicPresentation: source,
  });
  opened.push(runtime);
  expect(runtime.client.transport.jsonResponseDecodingVersion).toBe(1);
  expect(await runtime.publicPresentation!.listProjects()).toEqual([]);
  expect(fetch.mock.calls[0][0]).toBe("/admitted/public/projects");
  runtime.close();
  expect(() => runtime.publicPresentation!.listProjects()).toThrow("Native runtime was closed.");
  expect(fetch).toHaveBeenCalledOnce();
});

it("discards a late public response even when the original fetch ignores abort", async () => {
  let complete!: (value: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const runtime = createNativeRuntime({
    scope,
    client: createNacClient({ endpoint: scope.endpoint, fetch }),
    publicPresentation: source,
  });
  opened.push(runtime);
  const result = runtime.queryClient
    .fetchQuery({
      queryKey: ["public-native-v1", "projects"],
      queryFn: () => runtime.publicPresentation!.listProjects(),
    })
    .then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  runtime.close();
  complete(Response.json([{ project_id: "late" }]));
  expect(await result).toHaveProperty("error");
  expect(runtime.queryClient.getQueryCache().getAll()).toEqual([]);
});

it("rejects a pre-codec client before allocating presentation state", () => {
  const client = createNacClient({ endpoint: scope.endpoint, fetch: vi.fn() });
  const transport = new Proxy(client.transport, {
    get: (target, key, receiver) =>
      key === "jsonResponseDecodingVersion" ? undefined : Reflect.get(target, key, receiver),
  });
  const storage = { getItem: vi.fn(), setItem: vi.fn() };
  expect(() =>
    createNativeRuntime({ scope, client: { transport }, storage, publicPresentation: source }),
  ).toThrow("response codec support");
  expect(storage.getItem).not.toHaveBeenCalled();
});

it("preserves standalone native response decoding without requiring public codecs", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ orchestration_enabled: false, diagnostic: null }));
  const runtime = createNativeRuntime({
    scope,
    client: createNacClient({ endpoint: scope.endpoint, fetch }),
  });
  opened.push(runtime);
  expect(runtime.publicPresentation).toBeUndefined();
  expect(await runtime.client.getUiConfiguration()).toEqual({
    orchestration_enabled: false,
    diagnostic: null,
  });
  expect(fetch.mock.calls[0][0]).toBe("/admitted/ui-config");
});
