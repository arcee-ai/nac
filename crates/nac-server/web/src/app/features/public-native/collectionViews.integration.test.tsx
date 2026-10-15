/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativePresentationRoot } from "@/app/runtime/NativePresentationRoot";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import {
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  useAssignSessionToProject,
  useMoveProjectOrder,
  useProjects,
} from "@/app/services/queries/projects";
import {
  useCreateSession,
  useDeleteSession,
  useUpdatePresentation,
  useMoveSessionOrder,
  useUpdateConfig,
  useSessions,
  useSessionsWithWorkspaceStats,
} from "@/app/services/queries/session";
import { queryKeys } from "@/app/services/queries/keys";
import { UnsupportedCollectionCommand } from "./collectionViews";
import type { PublicNacPresentationSource } from "../../../../packages/nac-client/src/publicNacApi.js";
import type {
  PublicNacProject,
  PublicNacSessionSummary,
} from "../../../../packages/nac-client/src/publicNative.generated.js";

// Synthetic UI fixtures only; production requires the caller's canonical decoders.
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
const project: PublicNacProject = {
  project_id: "project",
  name: "Public project",
  description: null,
  pinned: false,
  presentation_version: "9223372036854775807",
  sort_order: "9007199254740993",
  default_model_config_id: null,
};
const session: PublicNacSessionSummary = {
  session_id: "session",
  title: "Public chat",
  model: "model",
  behavior: "direct",
  project_id: null,
  pinned: false,
  sort_order: "9007199254740993",
  presentation_version: "9223372036854775807",
  run_count: "1",
  visible_message_count: "1",
  total_tokens: "18446744073709551615",
  total_cost_micros: "18446744073709551615",
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T01:00:00Z",
};
const opened: NativeRuntime[] = [];
beforeEach(() =>
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })),
);
afterEach(() => {
  cleanup();
  for (const runtime of opened.splice(0)) runtime.close();
  vi.unstubAllGlobals();
});
function instance(empty = false) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = String(input);
    if (path === "/admitted/public/ui-config")
      return Response.json({ orchestration_enabled: false, diagnostic_codes: [] });
    if (path === "/admitted/public/projects") return Response.json(empty ? [] : [project]);
    if (path === "/admitted/public/sessions") return Response.json(empty ? [] : [session]);
    throw new Error(`Unexpected request: ${path}`);
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
  return { runtime, fetch };
}
function Wrapper({ runtime, children }: { runtime: NativeRuntime; children: ReactNode }) {
  return (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
}

it("renders public collections through the original App and query cache without private reads or inferred provenance", async () => {
  const { runtime, fetch } = instance();
  const view = render(
    <NativePresentationRoot
      runtime={runtime}
      router={(children) => <MemoryRouter>{children}</MemoryRouter>}
    />,
  );
  await waitFor(() => expect(view.getAllByText("Public project").length).toBeGreaterThan(0));
  await waitFor(() => expect(view.getAllByText("Public chat").length).toBeGreaterThan(0));
  expect(view.getByText("$18446744073709.55")).toBeTruthy();
  for (const name of ["Local", "SSH", "MCP servers", "New chat", "Drag to reorder"]) {
    expect(view.queryByRole("button", { name })).toBeNull();
  }
  expect(view.queryByText("Local")).toBeNull();
  expect(fetch.mock.calls.map(([path]) => path).sort()).toEqual([
    "/admitted/public/projects",
    "/admitted/public/sessions",
    "/admitted/public/ui-config",
  ]);
  expect(runtime.queryClient.getQueryData(queryKeys.projects)).toMatchObject({
    projects: [{ presentation: "public", presentation_version: project.presentation_version }],
  });
});

it("shares collection ownership across list and workspace observers without requesting private stats", async () => {
  const { runtime, fetch } = instance();
  const hook = renderHook(() => [useProjects(), useSessions(), useSessionsWithWorkspaceStats()], {
    wrapper: ({ children }) => <Wrapper runtime={runtime}>{children}</Wrapper>,
  });
  await waitFor(() => expect(hook.result.current.every((query) => query.isSuccess)).toBe(true));
  expect(fetch.mock.calls.map(([path]) => path).sort()).toEqual([
    "/admitted/public/projects",
    "/admitted/public/sessions",
  ]);
  expect(hook.result.current[1].data).toBe(hook.result.current[2].data);
});

it("keeps an empty public collection in the original list without exposing native creation", async () => {
  const { runtime, fetch } = instance(true);
  const view = render(
    <NativePresentationRoot
      runtime={runtime}
      router={(children) => <MemoryRouter>{children}</MemoryRouter>}
    />,
  );
  await view.findByText("Your projects will appear here.");
  expect(view.queryByRole("button", { name: /Get Started/i })).toBeNull();
  expect(fetch.mock.calls.every(([path]) => String(path).startsWith("/admitted/public/"))).toBe(
    true,
  );
});

it("refuses every collection mutation before the original transport is called", async () => {
  const { runtime, fetch } = instance();
  const hook = renderHook(
    () => ({
      createProject: useCreateProject(),
      updateProject: useUpdateProject(),
      deleteProject: useDeleteProject(),
      assign: useAssignSessionToProject(),
      moveProject: useMoveProjectOrder(),
      createSession: useCreateSession(),
      deleteSession: useDeleteSession(),
      updatePresentation: useUpdatePresentation(),
      moveSession: useMoveSessionOrder(),
      updateConfig: useUpdateConfig(),
    }),
    { wrapper: ({ children }) => <Wrapper runtime={runtime}>{children}</Wrapper> },
  );
  const commands = () => [
    hook.result.current.createProject.mutateAsync({ name: "No dispatch", cwd: "/private" }),
    hook.result.current.updateProject.mutateAsync({
      projectId: "project",
      payload: { name: "No dispatch" },
    }),
    hook.result.current.deleteProject.mutateAsync({ projectId: "project" }),
    hook.result.current.assign.mutateAsync({ projectId: "project", sessionId: "session" }),
    hook.result.current.moveProject.mutateAsync({
      projects: [],
      projectId: "project",
      targetPinned: true,
      targetIndex: 0,
    }),
    hook.result.current.createSession.mutateAsync({ cwd: "/private" }),
    hook.result.current.deleteSession.mutateAsync("session"),
    hook.result.current.updatePresentation.mutateAsync({
      id: "session",
      title: "No dispatch",
      pinned: false,
      expectedVersion: 1,
    }),
    hook.result.current.moveSession.mutateAsync({
      sessions: [],
      sessionId: "session",
      targetPinned: true,
      targetIndex: 0,
    }),
    hook.result.current.updateConfig.mutateAsync({
      id: "session",
      patch: { model: "No dispatch" },
    }),
  ];
  await act(async () => {
    const outcomes = await Promise.allSettled(commands());
    expect(outcomes).toHaveLength(10);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected")
        expect(outcome.reason).toBeInstanceOf(UnsupportedCollectionCommand);
    }
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(runtime.queryClient.getQueryCache().getAll()).toHaveLength(0);
});
