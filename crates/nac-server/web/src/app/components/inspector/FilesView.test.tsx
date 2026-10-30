/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilesView } from "@/app/components/inspector/FilesView";
import { formatStoreTime } from "@/app/lib/format";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { RuntimeContext, useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { createNacClient } from "@/app/services/nacClient";
import type {
  ChangedFileStat,
  SessionSnapshotResponse,
  WorkspaceFileDiff,
  WorkspaceRevision,
} from "@/app/types/api";

const SESSION = "files-source";
const WORKING_TREE = "Working tree — all checkout changes";

const opened: NativeRuntime[] = [];

function runtime(fetch: typeof globalThis.fetch) {
  const endpoint = "https://host.example/nac";
  const value = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "host",
      incarnation: "host",
      endpoint,
      release: "test",
    },
    client: createNacClient({ endpoint, credentials: "omit", fetch }),
    storage: { getItem: () => null, setItem: vi.fn() },
  });
  opened.push(value);
  return value;
}

/** The panel as the side box mounts it: following the shared revision selection. */
function SelectedFiles({ snapshot }: { snapshot: SessionSnapshotResponse }) {
  const { useSelectedRevision } = useNativeRuntime().stores.sessionLayoutStore;
  return <FilesView sessionId={SESSION} snapshot={snapshot} revision={useSelectedRevision()} />;
}

function mount(value: NativeRuntime, snapshot: SessionSnapshotResponse) {
  return render(
    <QueryClientProvider client={value.queryClient}>
      <RuntimeContext.Provider value={value}>
        <ToastProvider>
          <SelectedFiles snapshot={snapshot} />
        </ToastProvider>
      </RuntimeContext.Provider>
    </QueryClientProvider>,
  );
}

function snapshotWith(changed: ChangedFileStat[]): SessionSnapshotResponse {
  return {
    workspace: {
      branch: "main",
      changed_files: changed,
      total_additions: 0,
      total_deletions: 0,
      workspace_display: "workspace",
    },
  } as unknown as SessionSnapshotResponse;
}

function revisionRecord(id: number, runId: string, createdAt: string): WorkspaceRevision {
  return {
    id,
    run_id: runId,
    session_id: SESSION,
    commit_sha: `${id}`.repeat(40).slice(0, 40),
    base_sha: "b".repeat(40),
    branch: "main",
    label: "edit the agent file",
    created_at: createdAt,
    additions: 1,
    deletions: 0,
    changed_files: 1,
    transcript_len: null,
  };
}

function diffOf(path: string, line: string): WorkspaceFileDiff {
  return {
    path,
    old_path: null,
    error: null,
    sections: [
      {
        stage: "unstaged",
        status: "M",
        additions: 1,
        deletions: 0,
        binary: false,
        too_large: false,
        truncated: false,
        error: null,
        hunks: [
          {
            old_start: 1,
            old_lines: 0,
            new_start: 1,
            new_lines: 1,
            function_context: null,
            lines: [
              {
                kind: "insert",
                content: line,
                old_lineno: null,
                new_lineno: 1,
                has_trailing_newline: true,
              },
            ],
          },
        ],
      },
    ],
  };
}

type Route = () => Response | Promise<Response>;

/** Answers each request by its path and query, failing loudly on anything unplanned. */
function routedFetch(routes: Record<string, Route>) {
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(String(input));
    const key = `${url.pathname.replace(`/nac/sessions/${SESSION}`, "")}${url.search}`;
    const route = routes[key];
    if (!route) return Response.json({ error: `unplanned ${key}` }, { status: 500 });
    return route();
  });
}

const json = (body: unknown) => () => Response.json(body);

const RUN = "4f1c2a9e-8b7d-4c3a-9e21-0f6d5b4a3c2d";
const CAPTURED_AT = "2026-10-30T10:05:00Z";
const REVISIONS = [
  revisionRecord(7, RUN, CAPTURED_AT),
  revisionRecord(6, "11111111-2222-3333-4444-555555555555", "2026-10-30T09:00:00Z"),
];
const WORKING_FILES = ["agent.txt", "pre-existing.txt", "src/main.rs"];
const WORKING_CHANGES: ChangedFileStat[] = [
  { path: "agent.txt", status: "M", additions: 1, deletions: 0 },
  { path: "pre-existing.txt", status: "M", additions: 1, deletions: 0 },
];
const CAPTURED_CHANGES = {
  changed_files: [{ path: "agent.txt", status: "M", additions: 1, deletions: 0 }],
  total_additions: 1,
  total_deletions: 0,
};

const sourceLabel = () => screen.getByRole("status", { name: "Files source" });

/** The list's row for a path, leaving out the open file's heading, which shares its title. */
const row = (path: string) =>
  screen.queryAllByTitle(path).find((element) => element.tagName === "BUTTON") ?? null;
const findRow = (path: string) =>
  waitFor(() => {
    const element = row(path);
    if (!element) throw new Error(`no row for ${path}`);
    return element;
  });

beforeEach(() => {
  // A desktop width, so the list and the open file sit side by side.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1280px)",
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  cleanup();
  for (const value of opened.splice(0)) value.close();
  vi.unstubAllGlobals();
});

describe("Files source label", () => {
  it("labels the whole checkout as the working tree and keeps every kind of change", async () => {
    const value = runtime(
      routedFetch({
        "/workspace/files": json({
          files: ["pre-existing.txt", "renamed-new.txt", "scratch/a.txt", "src/main.rs"],
          truncated: true,
        }),
        "/workspace/diff?path=gone.txt&stage=all&context=3": json(diffOf("gone.txt", "")),
      }),
    );
    value.stores.sessionLayoutStore.selectFileListing("changed");
    mount(
      value,
      snapshotWith([
        { path: "gone.txt", status: "D", additions: 0, deletions: 1 },
        { path: "pre-existing.txt", status: "M", additions: 1, deletions: 0 },
        { path: "renamed-new.txt", status: "R", additions: 0, deletions: 0 },
        { path: "scratch/", status: "?" },
      ]),
    );

    await findRow("pre-existing.txt");
    expect(sourceLabel().textContent).toContain(WORKING_TREE);
    // Nothing is filtered by who made it: unrelated, deleted, renamed and
    // untracked entries are all listed under the one working-tree label.
    for (const path of ["gone.txt", "pre-existing.txt", "renamed-new.txt", "scratch/a.txt"]) {
      expect(row(path)).toBeTruthy();
    }
    expect(row("src/main.rs")).toBeNull();
    expect(screen.getByText("Listing truncated.")).toBeTruthy();
    // The first change opens by itself; the panel says that is navigation.
    expect(sourceLabel().textContent).toContain(
      "Opened first for navigation only; it does not say who changed it.",
    );
    expect(screen.queryByRole("button", { name: "Back to working tree" })).toBeNull();
  });

  it("names the captured run and its capture time, with a way back to the working tree", async () => {
    const workingFiles = Promise.withResolvers<Response>();
    const value = runtime(
      routedFetch({
        "/workspace/files": () => workingFiles.promise,
        "/workspace/files?revision=7": json({ files: WORKING_FILES, truncated: false }),
        "/workspace/revisions": json(REVISIONS),
        "/workspace/revisions/7/changes": json(CAPTURED_CHANGES),
        "/workspace/diff?path=agent.txt&stage=all&context=3&revision=7": json(
          diffOf("agent.txt", "captured line"),
        ),
        "/workspace/diff?path=agent.txt&stage=all&context=3": json(
          diffOf("agent.txt", "working line"),
        ),
      }),
    );
    value.stores.sessionLayoutStore.selectFileListing("changed");
    value.stores.sessionLayoutStore.selectRevision(7);
    mount(value, snapshotWith(WORKING_CHANGES));

    await screen.findByText("Snapshot 2 — captured after a run");
    const label = sourceLabel().textContent ?? "";
    expect(label).not.toContain(WORKING_TREE);
    expect(label).toContain(`Run ${RUN.slice(0, 8)}`);
    expect(label).toContain(`captured ${formatStoreTime(CAPTURED_AT)}`);
    expect(label).toContain("Changes since Snapshot 1");
    // Only what the capture recorded, not the pre-existing checkout change.
    expect(row("agent.txt")).toBeTruthy();
    expect(row("pre-existing.txt")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to working tree" }));
    expect(value.stores.sessionLayoutStore.sessionLayoutStore.getState().selectedRevision).toBe(
      null,
    );
    // The capture's listing is still the newest one held, so it is not drawn
    // under the working tree's name until the working tree's own arrives.
    await screen.findByText("Working tree — loading…");
    expect(row("agent.txt")).toBeNull();
    expect(sourceLabel().textContent).not.toContain("Snapshot 2");

    workingFiles.resolve(Response.json({ files: WORKING_FILES, truncated: false }));
    expect(await findRow("pre-existing.txt")).toBeTruthy();
    expect(sourceLabel().textContent).toContain(WORKING_TREE);
  });

  it("never names the capture over the working tree's rows while the capture is fetched", async () => {
    const files = Promise.withResolvers<Response>();
    const changes = Promise.withResolvers<Response>();
    const olderFiles = Promise.withResolvers<Response>();
    const olderChanges = Promise.withResolvers<Response>();
    const value = runtime(
      routedFetch({
        "/workspace/files": json({ files: WORKING_FILES, truncated: false }),
        "/workspace/files?revision=7": () => files.promise,
        "/workspace/revisions": json(REVISIONS),
        "/workspace/revisions/7/changes": () => changes.promise,
        "/workspace/diff?path=agent.txt&stage=all&context=3": json(
          diffOf("agent.txt", "working line"),
        ),
        "/workspace/diff?path=agent.txt&stage=all&context=3&revision=7": json(
          diffOf("agent.txt", "captured line"),
        ),
        "/workspace/files?revision=6": () => olderFiles.promise,
        "/workspace/revisions/6/changes": () => olderChanges.promise,
      }),
    );
    const layout = value.stores.sessionLayoutStore;
    layout.selectFileListing("changed");
    mount(value, snapshotWith(WORKING_CHANGES));
    await findRow("pre-existing.txt");
    expect(sourceLabel().textContent).toContain(WORKING_TREE);

    act(() => layout.selectRevision(7));
    await screen.findByText("Snapshot 2 — loading capture…");
    // The working tree's rows are not shown under the capture's name, and the
    // capture's name is not shown over them.
    expect(row("pre-existing.txt")).toBeNull();
    expect(row("agent.txt")).toBeNull();
    expect(sourceLabel().textContent).not.toContain(WORKING_TREE);
    expect(screen.queryByText("working line")).toBeNull();

    files.resolve(Response.json({ files: WORKING_FILES, truncated: false }));
    // Half of the capture is not the capture either.
    await waitFor(() => expect(row("pre-existing.txt")).toBeNull());
    expect(sourceLabel().textContent).toContain("loading capture");

    changes.resolve(Response.json(CAPTURED_CHANGES));
    await screen.findByText("Snapshot 2 — captured after a run");
    expect(row("agent.txt")).toBeTruthy();
    expect(row("pre-existing.txt")).toBeNull();
    expect(await screen.findByText("captured line")).toBeTruthy();

    // From one capture to another: the newer capture's rows are not the older's.
    act(() => layout.selectRevision(6));
    await screen.findByText("Snapshot 1 — loading capture…");
    expect(row("agent.txt")).toBeNull();
    expect(screen.queryByText("captured line")).toBeNull();
    olderFiles.resolve(Response.json({ files: ["pre-existing.txt"], truncated: false }));
    olderChanges.resolve(
      Response.json({
        changed_files: [{ path: "pre-existing.txt", status: "A", additions: 1, deletions: 0 }],
        total_additions: 1,
        total_deletions: 0,
      }),
    );
    await screen.findByText("Snapshot 1 — captured after a run");
    expect(await findRow("pre-existing.txt")).toBeTruthy();
    expect(row("agent.txt")).toBeNull();

    // Back again: the working tree is cached, so its own rows return at once.
    act(() => layout.selectRevision(null));
    await findRow("pre-existing.txt");
    expect(sourceLabel().textContent).toContain(WORKING_TREE);
  });

  it("does not show the working tree's diff under the capture while the capture's diff loads", async () => {
    // A gate rather than a response: the first visit's request is abandoned, and
    // each request reads a body of its own.
    const capturedDiff = Promise.withResolvers<void>();
    const value = runtime(
      routedFetch({
        "/workspace/files": json({ files: WORKING_FILES, truncated: false }),
        "/workspace/files?revision=7": json({ files: WORKING_FILES, truncated: false }),
        "/workspace/revisions": json(REVISIONS),
        "/workspace/revisions/7/changes": json(CAPTURED_CHANGES),
        "/workspace/diff?path=agent.txt&stage=all&context=3": json(
          diffOf("agent.txt", "working line"),
        ),
        "/workspace/diff?path=agent.txt&stage=all&context=3&revision=7": () =>
          capturedDiff.promise.then(() => Response.json(diffOf("agent.txt", "captured line"))),
      }),
    );
    const layout = value.stores.sessionLayoutStore;
    layout.selectFile("agent.txt");
    layout.selectRevision(7);
    mount(value, snapshotWith(WORKING_CHANGES));
    // A first visit leaves the capture's rows cached and its diff still loading.
    await screen.findByText("Snapshot 2 — captured after a run");
    expect(await screen.findByText("Loading diff…")).toBeTruthy();
    act(() => layout.selectRevision(null));
    expect(await screen.findByText("working line")).toBeTruthy();

    // Now the switch is instant, so only the open file's diff is still loading.
    act(() => layout.selectRevision(7));
    await screen.findByText("Snapshot 2 — captured after a run");
    expect(screen.queryByText("working line")).toBeNull();

    capturedDiff.resolve();
    expect(await screen.findByText("captured line")).toBeTruthy();
  });

  it("says a capture is unavailable rather than showing it as empty or as the working tree", async () => {
    const value = runtime(
      routedFetch({
        "/workspace/files": json({ files: WORKING_FILES, truncated: false }),
        "/workspace/files?revision=7": json({ files: WORKING_FILES, truncated: false }),
        "/workspace/files?revision=6": json({ files: WORKING_FILES, truncated: false }),
        "/workspace/files?revision=9": json({ files: WORKING_FILES, truncated: false }),
        "/workspace/revisions": json(REVISIONS),
        "/workspace/revisions/7/changes": () =>
          Response.json({ error: "revision '7' was not found" }, { status: 404 }),
        "/workspace/revisions/6/changes": json({
          changed_files: [],
          total_additions: 0,
          total_deletions: 0,
          error: "git diff unavailable",
        }),
        "/workspace/revisions/9/changes": json(CAPTURED_CHANGES),
      }),
    );
    const layout = value.stores.sessionLayoutStore;
    layout.selectFileListing("changed");
    layout.selectRevision(7);
    mount(value, snapshotWith(WORKING_CHANGES));

    await screen.findByText("Snapshot 2 — capture unavailable");
    expect(sourceLabel().textContent).toContain("revision '7' was not found");
    expect(row("pre-existing.txt")).toBeNull();
    expect(screen.queryByText("Nothing has changed here yet.")).toBeNull();

    act(() => layout.selectRevision(6));
    await screen.findByText("Snapshot 1 — capture unavailable");
    expect(sourceLabel().textContent).toContain("git diff unavailable");
    expect(screen.queryByText("Nothing has changed here yet.")).toBeNull();

    // A revision the session no longer lists has no capture to name.
    act(() => layout.selectRevision(9));
    await screen.findByText("Captured snapshot — capture unavailable");
    expect(row("agent.txt")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to working tree" }));
    await findRow("pre-existing.txt");
    expect(sourceLabel().textContent).toContain(WORKING_TREE);
  });
});
