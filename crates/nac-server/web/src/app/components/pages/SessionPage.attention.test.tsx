/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativePresentationRoot } from "@/app/runtime/NativePresentationRoot";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import { queryKeys } from "@/app/services/queries/keys";
import type { ManagedSessionSummary } from "@/app/types/api";

// Keep the production App route, SessionPage, queries, runtime stores and ACK
// controller. Transcript/composer/panel rendering is unrelated to ACK ownership.
vi.mock("@/app/components/inspector/Transcript", () => ({
  Transcript: ({ sessionId }: { sessionId: string }) => (
    <output aria-label="Opened task">{sessionId}</output>
  ),
}));
vi.mock("@/app/components/inspector/ChatInputBox", () => ({ ChatInputBox: () => null }));
vi.mock("@/app/components/inspector/SessionSideBox", () => ({ SessionSideBox: () => null }));
vi.mock("@/app/components/inspector/TopSingleSessionHeader", () => ({
  TopSingleSessionHeader: () => null,
}));
vi.mock("@/app/components/inspector/RightSidebarRail", () => ({ RightSidebarRail: () => null }));
vi.mock("@/app/components/inspector/transcript/TranscriptModelProvider", () => ({
  TranscriptModelProvider: ({ children }: { children: ReactNode }) => children,
}));

const instances: NativeRuntime[] = [];
let mobile = false;
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: mobile ? query.includes("max-width: 767.98px") : query.includes("min-width: 1280px"),
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  for (const runtime of instances.splice(0)) runtime.close();
  mobile = false;
  vi.unstubAllGlobals();
});

function task(id: string, sequence: number): ManagedSessionSummary {
  return {
    summary: {
      session_id: id,
      behavior: "direct",
      project_id: null,
      title: id,
      backend: "openai-responses",
      cwd: "/retained-task",
      model: "model",
      created_at: "2026-11-01T12:00:00Z",
      updated_at: "2026-11-01T12:00:00Z",
      visible_message_count: 0,
      sandboxed: false,
      ssh_host: null,
      pinned: false,
      sort_order: 0,
      presentation_version: 0,
      last_user_prompt: null,
    },
    active_run: null,
    heartbeat_results: [
      {
        occurrence_id: `occurrence-${id}`,
        schedule_id: "one-schedule",
        run_id: `initial-${id}`,
        outcome: "unchanged",
        sequence,
        seen: false,
      },
    ],
  } as ManagedSessionSummary;
}

function fixture(name: string, delayed = false) {
  let sessions = [task("first", 1), task("sibling", 2)];
  const summary = Promise.withResolvers<Response>();
  const acknowledgements: { path: string; sequence: number }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const path = String(input)
      .slice(name.length + 1)
      .split("?")[0];
    if (path === "/sessions") return delayed ? summary.promise : Response.json(sessions);
    if (path === "/ui-config")
      return Response.json({ orchestration_enabled: false, diagnostic: null });
    if (path === "/projects") return Response.json({ projects: [] });
    if (path === "/managed/status") return Response.json({}, { status: 404 });
    if (path.endsWith("/heartbeats/attention") && init?.method === "POST") {
      const sequence = JSON.parse(String(init.body)).through_sequence as number;
      acknowledgements.push({ path, sequence });
      const id = path.split("/")[2];
      sessions = sessions.map((entry) =>
        entry.summary.session_id === id
          ? {
              ...entry,
              heartbeat_results: entry.heartbeat_results?.map((result) => ({
                ...result,
                seen: result.sequence <= sequence,
              })),
            }
          : entry,
      );
      return new Response(null, { status: 204 });
    }
    if (path === "/sessions/first")
      return Response.json({
        metadata: sessions[0].summary,
        messages: [],
        message_created_at: [],
        message_page: { start: 0, end: 0, total: 0, has_older: false },
      });
    return Response.json({ servers: [], configurations: [], providers: [], credentials: [] });
  });
  const runtime = createNativeRuntime({
    scope: {
      owner: name,
      profile: "standalone",
      organization: name,
      host: name,
      incarnation: name,
      endpoint: `/${name}`,
      release: "test",
    },
    client: createNacClient({ endpoint: `/${name}`, fetch }),
    eventSource: () =>
      ({
        addEventListener() {},
        close() {},
        onopen: null,
        onerror: null,
      }) as unknown as EventSource,
  });
  instances.push(runtime);
  return {
    runtime,
    fetch,
    acknowledgements,
    resolveSummary: (entries = sessions) => summary.resolve(Response.json(entries)),
    sessions: () => sessions,
  };
}

const router = (children: ReactNode) => (
  <MemoryRouter initialEntries={["/session/first/insights"]}>{children}</MemoryRouter>
);

it.each([
  { phone: false, late: false },
  { phone: false, late: true },
  { phone: true, late: false },
  { phone: true, late: true },
])(
  "ACKs the opened production route without All Projects (phone=$phone, late=$late)",
  async ({ phone, late }) => {
    mobile = phone;
    const f = fixture("selected", late);
    const track = vi.spyOn(f.runtime.stores.attentionStore, "trackAttention");
    const view = render(<NativePresentationRoot runtime={f.runtime} router={router} />);
    await waitFor(() => expect(view.getByLabelText("Opened task").textContent).toBe("first"));
    expect(Boolean(view.container.querySelector("[data-sidebar]"))).toBe(!phone);
    if (late) {
      expect(f.acknowledgements).toEqual([]);
      act(() => {
        f.runtime.stores.sessionLayoutStore.sessionLayoutStore.setState({
          selectedThread: "picked",
        });
      });
      await act(async () => f.resolveSummary());
    }
    await waitFor(() =>
      expect(f.acknowledgements).toEqual([
        { path: "/sessions/first/heartbeats/attention", sequence: 1 },
      ]),
    );
    expect(track).not.toHaveBeenCalled();
    expect(f.sessions().map((entry) => entry.heartbeat_results?.[0].seen)).toEqual([true, false]);
    if (late)
      expect(f.runtime.stores.sessionLayoutStore.sessionLayoutStore.getState().selectedThread).toBe(
        "picked",
      );
  },
);

it("ignores a foreign summary until the selected task appears", async () => {
  const f = fixture("foreign", true);
  const view = render(<NativePresentationRoot runtime={f.runtime} router={router} />);
  await waitFor(() => expect(view.getByLabelText("Opened task")).toBeDefined());
  await act(async () => f.resolveSummary([task("sibling", 2)]));
  expect(f.acknowledgements).toEqual([]);
  act(() => f.runtime.queryClient.setQueryData(queryKeys.sessions(false), f.sessions()));
  await waitFor(() => expect(f.acknowledgements).toHaveLength(1));
  expect(f.acknowledgements[0]).toEqual({
    path: "/sessions/first/heartbeats/attention",
    sequence: 1,
  });
});

it("does not transfer an old runtime's late summary to its replacement", async () => {
  const old = fixture("old", true);
  const next = fixture("next", true);
  const view = render(<NativePresentationRoot runtime={old.runtime} router={router} />);
  await waitFor(() => expect(view.getByLabelText("Opened task")).toBeDefined());
  view.rerender(<NativePresentationRoot runtime={next.runtime} router={router} />);
  await waitFor(() => expect(old.runtime.isClosed()).toBe(true));
  await act(async () => old.resolveSummary());
  expect(old.acknowledgements).toEqual([]);
  expect(next.acknowledgements).toEqual([]);
  await act(async () => next.resolveSummary());
  await waitFor(() => expect(next.acknowledgements).toHaveLength(1));
  expect(old.acknowledgements).toEqual([]);
});
