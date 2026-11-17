/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";
import {
  applyFleetAttention,
  attentionCoverage,
  emptyFleetAttention,
  pendingByRoot,
  useFleetAttention,
} from "@/app/services/queries/attention";
import type { FleetAttentionFrame, FleetAttentionSession } from "@/app/types/api";

const available = {
  work: "unknown",
  questions: "available",
  permissions: "available",
  reviews: "available",
  topology: "available",
} as const;

function entry(
  id: string,
  revision: number,
  overrides: Partial<FleetAttentionSession> = {},
): FleetAttentionSession {
  return {
    session_id: id,
    revision,
    project_id: null,
    lineage: null,
    pending: [],
    work: null,
    availability: available,
    activity: { kind: "idle" },
    last_outcome: null,
    queued: false,
    recovery_pending: false,
    ...overrides,
  };
}

const permission = (request_id: string) => ({
  kind: "permission" as const,
  request_id,
});

class FakeSource extends EventTarget {
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  constructor(readonly path: string) {
    super();
  }
  close() {
    this.closed = true;
  }
  frame(frame: FleetAttentionFrame) {
    this.dispatchEvent(new MessageEvent("fleet_attention", { data: JSON.stringify(frame) }));
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
}

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function harness(projectId?: string, stream?: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const sources: FakeSource[] = [];
  const eventSource = (path: string) => {
    const source = new FakeSource(path);
    sources.push(source);
    return source as unknown as EventSource;
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useFleetAttention({ projectId, eventSource, pollMs: 50, stream }), {
    wrapper,
  });
  return { hook, sources };
}

describe("applyFleetAttention", () => {
  it("keeps the newest revision and drops resolved identities", () => {
    const scope = null;
    let state = applyFleetAttention(emptyFleetAttention, {
      kind: "snapshot",
      scope,
      epoch: "e1",
      revision: 3,
      sessions: [entry("a", 3, { pending: [permission("p1")] }), entry("b", 2)],
    });
    state = applyFleetAttention(state, {
      kind: "changes",
      scope,
      epoch: "e1",
      revision: 4,
      upserts: [entry("a", 4)],
      removed: ["b"],
    });
    expect(state.sessions.get("a")?.pending).toEqual([]);
    expect(state.sessions.has("b")).toBe(false);
    // A stale poll in the same epoch never rolls the stream state back.
    const stale = applyFleetAttention(state, {
      kind: "snapshot",
      scope,
      epoch: "e1",
      revision: 3,
      sessions: [entry("a", 3, { pending: [permission("p1")] })],
    });
    expect(stale).toBe(state);
    // Old or foreign-epoch changes are ignored; a new epoch re-baselines.
    expect(
      applyFleetAttention(state, {
        kind: "changes",
        scope,
        epoch: "e0",
        revision: 9,
        upserts: [entry("z", 9)],
        removed: [],
      }),
    ).toBe(state);
    const restarted = applyFleetAttention(state, {
      kind: "snapshot",
      scope,
      epoch: "e2",
      revision: 1,
      sessions: [entry("c", 1)],
    });
    expect([...restarted.sessions.keys()]).toEqual(["c"]);
    // A different project filter is never merged into this one.
    const other = applyFleetAttention(state, {
      kind: "changes",
      scope: "project",
      epoch: "e1",
      revision: 9,
      upserts: [entry("z", 9)],
      removed: [],
    });
    expect(other).toBe(state);
  });
});

describe("attentionCoverage and pendingByRoot", () => {
  it("reports unknown and unsupported facets instead of claiming nothing is pending", () => {
    const dormant = entry("dormant", 1, {
      availability: {
        ...available,
        permissions: "unknown",
        reviews: "unknown",
      },
    });
    const child = entry("child", 1, {
      availability: {
        ...available,
        permissions: "unsupported",
        reviews: "unsupported",
        questions: "unsupported",
      },
    });
    expect(attentionCoverage(dormant)).toEqual({
      pending: [],
      unknown: ["permissions", "reviews"],
      unsupported: [],
    });
    expect(attentionCoverage(child).unsupported).toEqual(["permissions", "questions", "reviews"]);
  });

  it("rolls a delegated session's pending decisions up to its lineage root", () => {
    const sessions = new Map(
      [
        entry("root", 1),
        entry("child", 1, {
          pending: [permission("p1")],
          lineage: {
            kind: "traditional-child",
            parent_session_id: "root",
            root_session_id: "root",
          },
        }),
        entry("solo", 1, { pending: [{ kind: "review", review_id: "r1" }] }),
      ].map((session) => [session.session_id, session]),
    );
    const roots = pendingByRoot(sessions);
    expect(roots.get("root")?.map((session) => session.session_id)).toEqual(["child"]);
    expect(roots.get("solo")?.[0].pending).toEqual([{ kind: "review", review_id: "r1" }]);
    expect(roots.has("child")).toBe(false);
  });
});

describe("useFleetAttention", () => {
  it("baselines by poll, goes live on the stream, and tracks exact pending identities", async () => {
    const poll = vi.spyOn(api, "fleetAttention").mockResolvedValue({
      epoch: "e1",
      revision: 1,
      sessions: [entry("a", 1)],
    });
    const { hook, sources } = harness();
    await waitFor(() => expect(hook.result.current.sessions.get("a")).toBeDefined());
    expect(sources).toHaveLength(1);
    expect(sources[0].path).toBe("/attention/stream");
    expect(hook.result.current.status).toBe("polling");

    act(() =>
      sources[0].frame({
        kind: "snapshot",
        epoch: "e1",
        revision: 2,
        sessions: [entry("a", 2)],
      }),
    );
    expect(hook.result.current.status).toBe("live");
    act(() =>
      sources[0].frame({
        kind: "changes",
        epoch: "e1",
        revision: 3,
        upserts: [entry("a", 3, { pending: [permission("p1")] })],
        removed: [],
      }),
    );
    expect(hook.result.current.sessions.get("a")?.pending).toEqual([permission("p1")]);
    act(() =>
      sources[0].frame({
        kind: "changes",
        epoch: "e1",
        revision: 4,
        upserts: [entry("a", 4)],
        removed: [],
      }),
    );
    expect(hook.result.current.sessions.get("a")?.pending).toEqual([]);
    expect(hook.result.current.revision).toBe(4);
    // Polling pauses while the stream is live.
    const calls = poll.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(poll.mock.calls.length).toBe(calls);
    hook.unmount();
    expect(sources[0].closed).toBe(true);
  });

  it("falls back to polling and reconnects after an error or an unavailable frame", async () => {
    vi.spyOn(api, "fleetAttention").mockResolvedValue({
      epoch: "e1",
      revision: 1,
      sessions: [entry("a", 1)],
    });
    const { hook, sources } = harness("project-a");
    await waitFor(() => expect(sources).toHaveLength(1));
    expect(sources[0].path).toBe("/attention/stream?project_id=project-a");
    act(() =>
      sources[0].frame({
        kind: "snapshot",
        epoch: "e1",
        revision: 2,
        sessions: [entry("a", 2)],
      }),
    );
    expect(hook.result.current.status).toBe("live");
    act(() => sources[0].fail());
    expect(sources[0].closed).toBe(true);
    expect(hook.result.current.status).toBe("polling");
    await waitFor(() => expect(sources).toHaveLength(2), { timeout: 3000 });
    act(() => sources[1].frame({ kind: "unavailable", reason: "capacity" }));
    expect(sources[1].closed).toBe(true);
    expect(hook.result.current.status).toBe("unavailable");
    await waitFor(() => expect(hook.result.current.status).toBe("polling"));
    // A fresh successful poll reestablishes health; cached rows alone cannot.
    expect(hook.result.current.sessions.get("a")).toBeDefined();
  });

  it("does not let a poll started before an unavailable frame restore cached health", async () => {
    const stale = Promise.withResolvers<{
      epoch: string;
      revision: number;
      sessions: FleetAttentionSession[];
    }>();
    const fresh =
      Promise.withResolvers<typeof stale.promise extends Promise<infer T> ? T : never>();
    const snapshot = { epoch: "e1", revision: 1, sessions: [entry("a", 1)] };
    const poll = vi
      .spyOn(api, "fleetAttention")
      .mockResolvedValueOnce(snapshot)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValue(fresh.promise);
    const { hook, sources } = harness();
    await waitFor(() => expect(hook.result.current.sessions.get("a")).toBeDefined());
    act(() => sources[0].frame({ kind: "snapshot", ...snapshot }));
    act(() => sources[0].fail());
    await waitFor(() => expect(poll).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sources).toHaveLength(2), { timeout: 3000 });
    act(() => sources[1].frame({ kind: "unavailable", reason: "store" }));
    expect(hook.result.current.status).toBe("unavailable");
    await act(async () => stale.resolve(snapshot));
    await waitFor(() => expect(poll.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(hook.result.current.status).toBe("unavailable");
    await act(async () => fresh.resolve({ ...snapshot, revision: 3 }));
    await waitFor(() => expect(hook.result.current.status).toBe("polling"));
  });

  it("polls without holding a stream when asked to", async () => {
    const poll = vi.spyOn(api, "fleetAttention").mockResolvedValue({
      epoch: "e1",
      revision: 1,
      sessions: [entry("a", 1)],
    });
    const { hook, sources } = harness(undefined, false);
    await waitFor(() => expect(hook.result.current.sessions.get("a")).toBeDefined());
    expect(hook.result.current.status).toBe("polling");
    await waitFor(() => expect(poll.mock.calls.length).toBeGreaterThan(1));
    expect(sources).toHaveLength(0);
  });

  it("reports unavailable when neither the stream nor the snapshot can be read", async () => {
    vi.spyOn(api, "fleetAttention").mockRejectedValue(new Error("503"));
    const { hook, sources } = harness();
    await waitFor(() => expect(hook.result.current.status).toBe("unavailable"));
    expect(sources[0]).toBeDefined();
    expect(hook.result.current.sessions.size).toBe(0);
  });
});
