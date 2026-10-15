/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfigurationsModal } from "@/app/components/modals/ConfigurationsModal";
import { SettingsModal } from "@/app/components/modals/SettingsModal";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import { useStoreInfo } from "@/app/services/queries/host";
import { useManagedHostStatus } from "@/app/features/managed/queries";
import type { PublicNacPresentationSource } from "../../../../packages/nac-client/src/publicNacApi.js";

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
const config = {
  session_id: "session",
  model: "public model",
  reasoning_effort: null,
  config_version: "9223372036854775807",
  light_model: null,
  provider_kind: null,
  diagnostic_codes: ["configuration_notice"],
};

function PrivateHostProbe() {
  useStoreInfo();
  useManagedHostStatus();
  return null;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  for (const runtime of opened.splice(0)) runtime.close();
  vi.unstubAllGlobals();
});

function mount(view: "settings" | "configurations", threshold?: null) {
  const calls: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = String(input);
    calls.push(path);
    if (path.endsWith("/public/models"))
      return Response.json({ catalog_version: "1", providers: [] });
    if (path.endsWith("/public/model-configs"))
      return Response.json([
        {
          config_id: "saved",
          name: "Approved preset",
          model: config.model,
          reasoning_effort: null,
          light_model: null,
          provider_kind: null,
          created_at: "2026-10-14T00:00:00Z",
          updated_at: "2026-10-14T00:00:00Z",
        },
      ]);
    if (path.endsWith("/public/sessions/session/config"))
      return Response.json(
        threshold === null ? { ...config, orchestrator_compaction_threshold: null } : config,
      );
    throw new Error(`Unexpected private read: ${path}`);
  });
  const runtime = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "host",
      incarnation: "incarnation",
      endpoint: "/admitted",
      release: "release",
    },
    client: createNacClient({ endpoint: "/admitted", fetch }),
    publicPresentation: source,
  });
  opened.push(runtime);
  render(
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>
        <MemoryRouter>
          <PrivateHostProbe />
          {view === "settings" ? (
            <SettingsModal open id="session" onClose={vi.fn()} />
          ) : (
            <ConfigurationsModal open onClose={vi.fn()} />
          )}
        </MemoryRouter>
      </QueryClientProvider>
    </RuntimeContext.Provider>,
  );
  return { runtime, calls };
}

it("shows projected settings without reading or inventing the private configuration", async () => {
  const { calls } = mount("settings");
  await screen.findByText(config.model);
  await waitFor(() => expect(calls).toContain("/admitted/public/models"));
  expect(screen.getByText("This configuration needs attention.")).toBeTruthy();
  expect(screen.queryByText("Context limit")).toBeNull();
  expect(screen.queryByText(/Extra headers/)).toBeNull();
  expect(screen.queryByText(/Provider connections/)).toBeNull();
  expect(calls.every((path) => path.startsWith("/admitted/public/"))).toBe(true);
});

it("renders an entitled null threshold as disabled without treating omission as null", async () => {
  mount("settings", null);
  expect(await screen.findByText("Disabled")).toBeTruthy();
});

it("reads public saved configurations as arrays without entering the private editor", async () => {
  const { calls } = mount("configurations");
  await screen.findByText(config.model);
  expect(screen.queryByText("New configuration")).toBeNull();
  expect(screen.queryByText(/API key/)).toBeNull();
  expect(calls).toContain("/admitted/public/model-configs");
  expect(calls.every((path) => path.startsWith("/admitted/public/"))).toBe(true);
});
