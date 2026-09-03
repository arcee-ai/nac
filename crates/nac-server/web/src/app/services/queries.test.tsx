/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, type RenderResult, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { api, type ListSessionsOptions } from "@/app/services/api";
import {
  queryKeys,
  useLoadOlderMessages,
  useSessionsWithWorkspaceStats,
  useSessionSkills,
  useThreadEventPages,
} from "@/app/services/queries";
import { fenceSessionSnapshot } from "@/app/services/sessionRefresh";
import type {
  ManagedSessionSummary,
  MessagesPageResponse,
  SessionSnapshotResponse,
  SkillCatalogEntry,
  ThreadEventPage,
} from "@/app/types/api";

// The real api object is the seam: spies on its methods delegate to the
// per-test fakes below, so no module mocking is involved. The real perfDebug
// module is inert unless explicitly enabled.
const requests = {
  listSessions: vi.fn(),
  listSessionSkills: vi.fn(),
  getMessages: vi.fn(),
  getThreadEvents: vi.fn(),
};

vi.spyOn(api, "listSessions").mockImplementation((...args) => requests.listSessions(...args));
vi.spyOn(api, "listSessionSkills").mockImplementation((...args) =>
  requests.listSessionSkills(...args),
);
vi.spyOn(api, "getMessages").mockImplementation((...args) => requests.getMessages(...args));
vi.spyOn(api, "getThreadEvents").mockImplementation((...args) => requests.getThreadEvents(...args));

function deferred<T>() {
  return Promise.withResolvers<T>();
}

function session(id: string, title: string, changed?: number): ManagedSessionSummary {
  // SAFETY: test fixture — the merge reads only summary.session_id/title and
  // moves workspace_diff opaquely; the remaining summary fields are omitted.
  return {
    summary: {
      session_id: id,
      title,
      pinned: false,
      presentation_version: 1,
    },
    workspace_diff: changed === undefined ? undefined : { added: changed, removed: 0, changed: 0 },
  } as ManagedSessionSummary;
}

function Harness() {
  const result = useSessionsWithWorkspaceStats({ baseMs: 5, statsMs: 30 });
  return (
    <output data-testid="sessions">
      {JSON.stringify(
        result.data?.map((entry) => ({
          title: entry.summary.title,
          workspaceDiff: entry.workspace_diff,
        })),
      )}
    </output>
  );
}
async function mount(client: QueryClient): Promise<RenderResult> {
  const renderer = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  await act(async () => undefined);
  return renderer;
}

function renderedData(renderer: RenderResult) {
  const content = renderer.getByTestId("sessions").textContent;
  return content ? JSON.parse(content) : undefined;
}

function snapshotWindow(): SessionSnapshotResponse {
  // SAFETY: test fixture — only the snapshot fields the paged-read fencing
  // under test reads are populated; the remaining response fields are unused.
  return {
    messages: [
      { role: "user", content: "kept-old" },
      { role: "assistant", content: "kept-new" },
    ],
    message_created_at: [null, null],
    message_page: {
      start: 2,
      end: 4,
      total: 4,
      has_older: true,
    },
  } as SessionSnapshotResponse;
}

function OlderMessagesHarness({
  id,
  onResult,
}: {
  id: string;
  onResult: (accepted: boolean) => void;
}) {
  const loadOlder = useLoadOlderMessages(id);
  return <button onClick={() => void loadOlder.mutateAsync().then(onResult)}>Load</button>;
}

function ThreadPageHarness({ id, threadName }: { id: string; threadName: string }) {
  const result = useThreadEventPages(id, threadName);
  return (
    <output data-testid="thread-page">{result.data?.pages[0]?.events[0]?.id ?? "loading"}</output>
  );
}

function SkillHarness({ id }: { id: string }) {
  const result = useSessionSkills(id);
  return <output data-testid="skills">{result.data?.[0]?.name ?? "loading"}</output>;
}

describe("session-list polling split", () => {
  it("keeps fast base data authoritative across slower stats polls", async () => {
    const delayedStats = deferred<ManagedSessionSummary[]>();
    let baseRead = 0;
    let statsRead = 0;
    // Hold the empty base response until after the late stats merge is
    // asserted — otherwise a 5ms base poll can race past the merge window.
    let allowEmptyBase = false;
    requests.listSessions.mockImplementation((options: ListSessionsOptions) => {
      if (options.workspaceStats) {
        statsRead += 1;
        if (statsRead === 1) return delayedStats.promise;
        return Promise.resolve([session("deleted", "stale", 99)]);
      }
      baseRead += 1;
      if (baseRead === 1) return Promise.resolve([session("kept", "old")]);
      if (!allowEmptyBase) return Promise.resolve([session("kept", "new")]);
      return Promise.resolve([]);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderer = await mount(client);

    await waitFor(() => {
      expect(renderedData(renderer)).toEqual([{ title: "old" }]);
    });
    expect(statsRead).toBe(1);

    await waitFor(() => {
      expect(renderedData(renderer)).toEqual([{ title: "new" }]);
    });

    await act(async () => {
      delayedStats.resolve([
        session("kept", "stale", 7),
        session("resurrected", "must not return", 3),
      ]);
      await delayedStats.promise;
    });
    await waitFor(() => {
      expect(renderedData(renderer)).toEqual([
        {
          title: "new",
          workspaceDiff: { added: 7, removed: 0, changed: 0 },
        },
      ]);
    });

    allowEmptyBase = true;
    await waitFor(() => {
      expect(renderedData(renderer)).toEqual([]);
      expect(statsRead).toBeGreaterThanOrEqual(2);
    });

    const readsAtUnmount = { baseRead, statsRead };
    renderer.unmount();
    const delay = Promise.withResolvers<void>();
    setTimeout(delay.resolve, 40);
    await delay.promise;
    expect({ baseRead, statsRead }).toEqual(readsAtUnmount);
  });
});

describe("paged read fencing", () => {
  it("rejects an older-message response after a destructive snapshot fence", async () => {
    const id = "session-race";
    const stalePage = deferred<MessagesPageResponse>();
    requests.getMessages.mockReturnValue(stalePage.promise);
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    client.setQueryData(queryKeys.sessionSnapshot(id), snapshotWindow());
    let accepted: boolean | undefined;
    const renderer = render(
      <QueryClientProvider client={client}>
        <OlderMessagesHarness
          id={id}
          onResult={(result) => {
            accepted = result;
          }}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(renderer.getByRole("button", { name: "Load" }));
    await waitFor(() => expect(requests.getMessages).toHaveBeenCalledOnce());
    fenceSessionSnapshot(id, true);
    await act(async () => {
      // SAFETY: test fixture — the page carries only the fields the merge
      // reads; the remaining response fields are omitted.
      stalePage.resolve({
        messages: [{ role: "user", content: "must-not-return" }],
        created_at: [null],
        page: { start: 1, end: 2, total: 4, has_older: true },
      } as MessagesPageResponse);
      await stalePage.promise;
    });

    await waitFor(() => expect(accepted).toBe(false));
    expect(
      client
        .getQueryData<SessionSnapshotResponse>(queryKeys.sessionSnapshot(id))
        ?.messages.map((message) => message.content),
    ).toEqual(["kept-old", "kept-new"]);
    renderer.unmount();
  });

  it("keeps a late page for thread A out of selected thread B", async () => {
    const pageA = deferred<ThreadEventPage>();
    const pageB = deferred<ThreadEventPage>();
    requests.getThreadEvents.mockImplementation((_id: string, threadName: string) =>
      threadName === "A" ? pageA.promise : pageB.promise,
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderer = render(
      <QueryClientProvider client={client}>
        <ThreadPageHarness id="session" threadName="A" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(requests.getThreadEvents).toHaveBeenCalledOnce());
    renderer.rerender(
      <QueryClientProvider client={client}>
        <ThreadPageHarness id="session" threadName="B" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(requests.getThreadEvents).toHaveBeenCalledTimes(2));

    await act(async () => {
      pageB.resolve({
        events: [
          {
            id: 20,
            created_at: "new",
            event: {
              type: "thread_finished",
              name: "B",
              exit_code: 0,
              timed_out: false,
            },
          },
        ],
        has_older: false,
        next_before_id: null,
      });
      await pageB.promise;
    });
    await waitFor(() => expect(renderer.getByTestId("thread-page").textContent).toBe("20"));
    await act(async () => {
      pageA.resolve({
        events: [
          {
            id: 10,
            created_at: "old",
            event: {
              type: "thread_finished",
              name: "A",
              exit_code: 0,
              timed_out: false,
            },
          },
        ],
        has_older: false,
        next_before_id: null,
      });
      await pageA.promise;
    });
    expect(renderer.getByTestId("thread-page").textContent).toBe("20");
    renderer.unmount();
  });
});

describe("session skill catalog", () => {
  it("keys catalogs by session and refetches when a session remounts", async () => {
    const reads = new Map<string, number>();
    requests.listSessionSkills.mockImplementation((id: string) => {
      const read = (reads.get(id) ?? 0) + 1;
      reads.set(id, read);
      return Promise.resolve([
        {
          name: `${id}-${read}`,
          description: id,
          compatibility: null,
        } satisfies SkillCatalogEntry,
      ]);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderer = render(
      <QueryClientProvider client={client}>
        <SkillHarness id="A" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(renderer.getByTestId("skills").textContent).toBe("A-1"));

    renderer.rerender(
      <QueryClientProvider client={client}>
        <SkillHarness id="B" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(renderer.getByTestId("skills").textContent).toBe("B-1"));

    renderer.rerender(
      <QueryClientProvider client={client}>
        <SkillHarness id="A" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(renderer.getByTestId("skills").textContent).toBe("A-2"));
    expect(requests.listSessionSkills.mock.calls.map(([id]) => id)).toEqual(["A", "B", "A"]);
  });
});
