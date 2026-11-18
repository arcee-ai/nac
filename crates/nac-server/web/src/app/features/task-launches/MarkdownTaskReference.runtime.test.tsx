/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type { ManagedSessionSummary } from "@/app/types/api";
import { MarkdownTaskReference } from "./MarkdownTaskReference";

const id = "38e19c14-37b7-4b7e-a687-a628529b088f";
const entry = {
  summary: { session_id: id, behavior: "direct", project_id: "p" },
  lineage: null,
} as ManagedSessionSummary;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function runtime(listSessions: (...args: never[]) => Promise<ManagedSessionSummary[]>) {
  return { ...standaloneRuntime, api: { listSessions } as unknown as typeof standaloneRuntime.api };
}
function Location() {
  return <output aria-label="route">{useLocation().pathname}</output>;
}
afterEach(cleanup);

it("keeps inventories isolated while one runtime is loading and unavailable", async () => {
  const late = deferred<ManagedSessionSummary[]>();
  const a = runtime(vi.fn().mockResolvedValue([entry]));
  const b = runtime(vi.fn().mockReturnValue(late.promise));
  render(
    <MemoryRouter>
      <section aria-label="A">
        <QueryClientProvider client={client()}>
          <RuntimeContext value={a}>
            <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          </RuntimeContext>
        </QueryClientProvider>
      </section>
      <section aria-label="B">
        <QueryClientProvider client={client()}>
          <RuntimeContext value={b}>
            <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          </RuntimeContext>
        </QueryClientProvider>
      </section>
    </MemoryRouter>,
  );
  const left = within(screen.getByRole("region", { name: "A" }));
  const right = within(screen.getByRole("region", { name: "B" }));
  await left.findByRole("link", { name: "Open" });
  expect(right.queryByRole("link")).toBeNull();
  expect(right.getByText(/Checking task availability/)).toBeTruthy();
  await act(async () => late.resolve([]));
  await right.findByText(/Task unavailable/);
  expect(left.getByRole("link", { name: "Open" })).toBeTruthy();
  expect(right.queryByRole("link")).toBeNull();
});

it("does not navigate after replacement while the old runtime inventory check is pending", async () => {
  const late = deferred<ManagedSessionSummary[]>();
  const listA = vi.fn().mockResolvedValueOnce([entry]).mockReturnValueOnce(late.promise);
  const a = runtime(listA);
  const b = runtime(vi.fn().mockResolvedValue([]));
  const cacheA = client(),
    cacheB = client();
  // NativePresentationRoot keys the entire provider tree by runtime identity.
  const subtree = (which: typeof a, cache: QueryClient, key: string) => (
    <QueryClientProvider key={key} client={cache}>
      <RuntimeContext value={which}>
        <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
      </RuntimeContext>
    </QueryClientProvider>
  );
  const view = render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      {subtree(a, cacheA, "a")}
      <Location />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("link", { name: "Open" }));
  await waitFor(() => expect(listA).toHaveBeenCalledTimes(2));
  view.rerender(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      {subtree(b, cacheB, "b")}
      <Location />
    </MemoryRouter>,
  );
  await screen.findByText(/Task unavailable/);
  await act(async () => late.resolve([entry]));
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  expect(screen.queryByRole("link")).toBeNull();
});

it("recovers after a failed activation when the shared inventory later succeeds", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce([entry])
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([entry]);
  const cache = client();
  const instance = runtime(list);
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <QueryClientProvider client={cache}>
        <RuntimeContext value={instance}>
          <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          <Location />
        </RuntimeContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const initial = await screen.findByRole("link", { name: "Open" });
  initial.focus();
  fireEvent.keyDown(initial, { key: "Enter" });
  await screen.findByText(/Task unavailable/);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Check again" }));
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  await act(async () => {
    await cache.refetchQueries();
  });
  const recovered = await screen.findByRole("link", { name: "Open" });
  expect(document.activeElement).toBe(recovered);
  fireEvent.click(recovered);
  await waitFor(() =>
    expect(screen.getByLabelText("route").textContent).toBe(`/session/${id}/insights`),
  );
});

it("does not navigate from stale cached data when the activation query is cancelled", async () => {
  const shared = deferred<ManagedSessionSummary[]>();
  const late = deferred<ManagedSessionSummary[]>();
  const list = vi
    .fn()
    .mockResolvedValueOnce([entry])
    .mockReturnValueOnce(shared.promise)
    .mockReturnValueOnce(late.promise);
  const cache = client();
  const instance = runtime(list);
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <QueryClientProvider client={cache}>
        <RuntimeContext value={instance}>
          <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          <Location />
        </RuntimeContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const link = await screen.findByRole("link", { name: "Open" });
  void cache.refetchQueries();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  fireEvent.click(link);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  await act(async () => {
    await cache.cancelQueries();
  });
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  expect(screen.getByText(/Checking task availability/)).toBeTruthy();
  await act(async () => late.resolve([]));
  await screen.findByText(/Task unavailable/);
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});

it.each(["error", "missing"])("allows a deliberate recheck after initial %s", async (reason) => {
  const list =
    reason === "error"
      ? vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([entry])
      : vi.fn().mockResolvedValueOnce([]).mockResolvedValue([entry]);
  const cache = client();
  const instance = runtime(list);
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <QueryClientProvider client={cache}>
        <RuntimeContext value={instance}>
          <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          <Location />
        </RuntimeContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByText(/Task unavailable/);
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  const link = await screen.findByRole("link", { name: "Open" });
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  fireEvent.click(link);
  await waitFor(() =>
    expect(screen.getByLabelText("route").textContent).toBe(`/session/${id}/insights`),
  );
});

it("fails closed if the shared inventory changes during the independent verification", async () => {
  const late = deferred<ManagedSessionSummary[]>();
  const list = vi.fn().mockResolvedValueOnce([entry]).mockReturnValueOnce(late.promise);
  const cache = client();
  const instance = runtime(list);
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <QueryClientProvider client={cache}>
        <RuntimeContext value={instance}>
          <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          <Location />
        </RuntimeContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole("link", { name: "Open" }));
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await act(async () => {
    cache.setQueryData(["sessions", { workspaceStats: false }], []);
  });
  await act(async () => late.resolve([entry]));
  await screen.findByText(/Task unavailable/);
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  expect(cache.getQueryData(["sessions", { workspaceStats: false }])).toEqual([]);
});

it("does not reinstate a deleted target from an older shared inventory response", async () => {
  const older = deferred<ManagedSessionSummary[]>();
  const fresh = deferred<ManagedSessionSummary[]>();
  const list = vi
    .fn()
    .mockResolvedValueOnce([entry])
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(fresh.promise);
  const cache = client();
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <QueryClientProvider client={cache}>
        <RuntimeContext value={runtime(list)}>
          <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          <Location />
        </RuntimeContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const link = await screen.findByRole("link", { name: "Open" });
  void cache.refetchQueries();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  fireEvent.click(link);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  await act(async () => fresh.resolve([]));
  await screen.findByText(/Task unavailable/);
  await act(async () => older.resolve([entry]));
  expect(cache.getQueryData(["sessions", { workspaceStats: false }])).toEqual([]);
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});

it("preserves a concurrent cache update when cancelling an older shared fetch", async () => {
  const older = deferred<ManagedSessionSummary[]>();
  const fresh = deferred<ManagedSessionSummary[]>();
  const list = vi
    .fn()
    .mockResolvedValueOnce([entry])
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(fresh.promise);
  const cache = client();
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <QueryClientProvider client={cache}>
        <RuntimeContext value={runtime(list)}>
          <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          <Location />
        </RuntimeContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const link = await screen.findByRole("link", { name: "Open" });
  void cache.refetchQueries();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  fireEvent.click(link);
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  await act(async () => {
    cache.setQueryData(["sessions", { workspaceStats: false }], []);
  });
  const updatedAt = cache.getQueryState(["sessions", { workspaceStats: false }])?.dataUpdatedAt;
  await act(async () => fresh.resolve([entry]));
  await screen.findByText(/Task unavailable/);
  await act(async () => older.resolve([entry]));
  const key = ["sessions", { workspaceStats: false }];
  expect(cache.getQueryData(key)).toEqual([]);
  expect(cache.getQueryState(key)?.status).toBe("success");
  expect(cache.getQueryState(key)?.error).toBeNull();
  expect(cache.getQueryState(key)?.dataUpdatedAt).toBe(updatedAt);
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});

it("does not reclaim focus when shared inventory changes during a pending check", async () => {
  const late = deferred<ManagedSessionSummary[]>();
  const list = vi.fn().mockResolvedValueOnce([entry]).mockReturnValueOnce(late.promise);
  const cache = client();
  render(
    <MemoryRouter>
      <QueryClientProvider client={cache}>
        <RuntimeContext value={runtime(list)}>
          <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          <button>Elsewhere</button>
        </RuntimeContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const link = await screen.findByRole("link", { name: "Open" });
  link.focus();
  fireEvent.keyDown(link, { key: "Enter" });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  elsewhere.focus();
  await act(async () => {
    cache.setQueryData(["sessions", { workspaceStats: false }], []);
  });
  expect(document.activeElement).toBe(elsewhere);
  await act(async () => late.resolve([entry]));
  expect(document.activeElement).toBe(elsewhere);
  expect(screen.queryByRole("link", { name: "Open" })).toBeNull();
});

it("does not reclaim focus from elsewhere when passive inventory restores the task", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce([entry])
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([entry]);
  const cache = client();
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <QueryClientProvider client={cache}>
        <RuntimeContext value={runtime(list)}>
          <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
          <button>Elsewhere</button>
          <Location />
        </RuntimeContext>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const initial = await screen.findByRole("link", { name: "Open" });
  initial.focus();
  fireEvent.keyDown(initial, { key: "Enter" });
  const retry = await screen.findByRole("button", { name: "Check again" });
  expect(document.activeElement).toBe(retry);
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  elsewhere.focus();
  await act(async () => {
    await cache.refetchQueries();
  });
  await screen.findByRole("link", { name: "Open" });
  expect(document.activeElement).toBe(elsewhere);
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});

it.each([true, false])(
  "handles passive inventory failure with link focus owned: %s",
  async (keepFocus) => {
    const list = vi.fn().mockResolvedValueOnce([entry]).mockRejectedValueOnce(new Error("offline"));
    const cache = client();
    render(
      <MemoryRouter initialEntries={["/session/caller/insights"]}>
        <QueryClientProvider client={cache}>
          <RuntimeContext value={runtime(list)}>
            <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
            <button>Elsewhere</button>
            <Location />
          </RuntimeContext>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: "Open" });
    link.focus();
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    if (!keepFocus) elsewhere.focus();
    await act(async () => {
      await cache.refetchQueries();
    });
    const retry = await screen.findByRole("button", { name: "Check again" });
    expect(document.activeElement).toBe(keepFocus ? retry : elsewhere);
    expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  },
);
