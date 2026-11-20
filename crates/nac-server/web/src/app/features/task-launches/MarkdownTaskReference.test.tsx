/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import MarkdownRenderer from "@/app/lib/markdown-renderer";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { taskReferenceId } from "./taskReference";
import { MarkdownTaskReference } from "./MarkdownTaskReference";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import type { ManagedSessionSummary } from "@/app/types/api";
const state = vi.hoisted(() => ({
  entries: [] as ManagedSessionSummary[],
  fail: false,
  refetch: null as null | (() => Promise<{ data: ManagedSessionSummary[]; isError: boolean }>),
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
vi.mock("@/app/services/queries/sessionInventory", () => ({
  useFreshSessionInventory: () => async () => {
    const result = await (state.refetch?.() ??
      Promise.resolve({ data: state.entries, isError: state.fail }));
    if (result.isError) throw new Error("inventory unavailable");
    return result.data;
  },
}));
vi.mock("@/app/services/queries/session", () => ({
  useSessions: (interval: number) => {
    expect(interval).toBe(0);
    return {
      data: state.entries,
      isPending: false,
      isError: false,
      dataUpdatedAt: 1,
      refetch: () =>
        (state.refetch?.() ?? Promise.resolve({ data: state.entries, isError: state.fail })).then(
          (result) => ({ dataUpdatedAt: 1, ...result }),
        ),
    };
  },
}));
const id = "38e19c14-37b7-4b7e-a687-a628529b088f";
const entry = {
  summary: { session_id: id, behavior: "direct", project_id: "other" },
  lineage: null,
} as ManagedSessionSummary;
afterEach(() => {
  cleanup();
  state.entries = [];
  state.fail = false;
  state.refetch = null;
});
it("fences concurrent activation and ignores an old runtime result", async () => {
  state.entries = [entry];
  let finish!: (value: { data: ManagedSessionSummary[]; isError: boolean }) => void;
  state.refetch = vi.fn(
    () =>
      new Promise<{ data: ManagedSessionSummary[]; isError: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const runtimeA = { ...standaloneRuntime },
    runtimeB = { ...standaloneRuntime };
  const app = (runtime: typeof standaloneRuntime) => (
    <RuntimeContext value={runtime}>
      <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
      <Location />
    </RuntimeContext>
  );
  const view = render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>{app(runtimeA)}</MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Open" });
  fireEvent.click(link);
  fireEvent.click(link);
  expect(state.refetch).toHaveBeenCalledTimes(1);
  view.rerender(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>{app(runtimeB)}</MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
  await act(async () => finish({ data: [entry], isError: false }));
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});
it("rechecks availability after replacing a runtime following failure", async () => {
  state.entries = [entry];
  state.fail = true;
  const runtimeA = { ...standaloneRuntime },
    runtimeB = { ...standaloneRuntime };
  const app = (runtime: typeof standaloneRuntime) => (
    <RuntimeContext value={runtime}>
      <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
    </RuntimeContext>
  );
  const view = render(<MemoryRouter>{app(runtimeA)}</MemoryRouter>);
  fireEvent.click(screen.getByRole("link", { name: "Open" }));
  await screen.findByText(/Task unavailable/);
  state.fail = false;
  view.rerender(<MemoryRouter>{app(runtimeB)}</MemoryRouter>);
  expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
});
it("handles a rejected activation and lets the user retry without navigating", async () => {
  state.entries = [entry];
  state.refetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("cancelled"))
    .mockResolvedValue({ data: [entry], isError: false });
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
      <Location />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Open" }));
  await screen.findByText(/Task unavailable/);
  expect(screen.queryByText(/Checking task availability/)).toBeNull();
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  const link = await screen.findByRole("link", { name: "Open" });
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  fireEvent.click(link);
  await waitFor(() =>
    expect(screen.getByLabelText("route").textContent).toBe(`/session/${id}/insights`),
  );
});

it("ignores a rejected check after replacing its runtime", async () => {
  state.entries = [entry];
  let reject!: (reason: Error) => void;
  state.refetch = () =>
    new Promise((_, fail) => {
      reject = fail;
    });
  const a = { ...standaloneRuntime },
    b = { ...standaloneRuntime };
  const viewFor = (runtime: typeof standaloneRuntime) => (
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <RuntimeContext value={runtime}>
        <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
      </RuntimeContext>
      <Location />
    </MemoryRouter>
  );
  const view = render(viewFor(a));
  fireEvent.click(screen.getByRole("link", { name: "Open" }));
  view.rerender(viewFor(b));
  await act(async () => reject(new Error("cancelled")));
  expect(screen.getByRole("link", { name: "Open" })).toBeTruthy();
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});

it("fences a pending result when the location or reference identity changes", async () => {
  state.entries = [entry];
  let finish!: (value: { data: ManagedSessionSummary[]; isError: boolean }) => void;
  state.refetch = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  function Switch() {
    const navigate = useNavigate();
    return <button onClick={() => navigate("/session/elsewhere/insights")}>Switch</button>;
  }
  const view = render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
      <Switch />
      <Location />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Open" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch" }));
  await act(async () => finish({ data: [entry], isError: false }));
  expect(screen.getByLabelText("route").textContent).toBe("/session/elsewhere/insights");
  fireEvent.click(screen.getByRole("link", { name: "Open" }));
  view.rerender(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <MarkdownTaskReference id="different">Other</MarkdownTaskReference>
      <Switch />
      <Location />
    </MemoryRouter>,
  );
  await act(async () => finish({ data: [entry], isError: false }));
  expect(screen.getByLabelText("route").textContent).toBe("/session/elsewhere/insights");
  expect(screen.queryByRole("link", { name: "Other" })).toBeNull();
});
function Location() {
  return <output aria-label="route">{useLocation().pathname}</output>;
}
function mount(source = `[Open research](/session/${id})`, enabled = true) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/session/caller/insights"]}>
        <ToastProvider>
          <MarkdownRenderer taskReferences={enabled}>{source}</MarkdownRenderer>
          <Location />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("routes a verified cross-project task after passive revalidation", async () => {
  state.entries = [entry];
  mount();
  fireEvent.click(screen.getByRole("link", { name: "Open research" }));
  await waitFor(() =>
    expect(screen.getByLabelText("route").textContent).toBe(`/session/${id}/insights`),
  );
});
it("does not route when the task disappears before activation", async () => {
  state.entries = [entry];
  mount();
  const link = screen.getByRole("link", { name: "Open research" });
  state.entries = [];
  fireEvent.click(link);
  await screen.findByText(/Task unavailable/);
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByText(/Task unavailable/);
  expect(screen.queryByRole("link", { name: "Open research" })).toBeNull();
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
  state.entries = [entry];
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await screen.findByRole("link", { name: "Open research" });
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});
it("keeps missing or ineligible tasks non-actionable", () => {
  state.entries = [];
  mount();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText(/Task unavailable/)).toBeTruthy();
});
it("preserves noninteractive history and code", () => {
  state.entries = [entry];
  mount(`\`[Open research](/session/${id})\``, false);
  expect(screen.queryByRole("link")).toBeNull();
});
it("does not enable task navigation in noninteractive history", () => {
  state.entries = [entry];
  mount(undefined, false);
  fireEvent.click(screen.getByRole("link", { name: "Open research" }));
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});
it.each([
  "/session/abc",
  `/session/${id}/files`,
  `/session/${id}?x=1`,
  `/session/${id}#x`,
  `//session/${id}`,
  `/session/${id.toUpperCase()}`,
  `/session%2f${id}`,
  `javascript:/session/${id}`,
])("rejects %s", (value) => {
  expect(taskReferenceId(value)).toBeNull();
});

it("announces and preserves keyboard focus through failure and retry", async () => {
  state.entries = [entry];
  let fail!: (reason: Error) => void;
  let succeed!: (value: { data: ManagedSessionSummary[]; isError: boolean }) => void;
  state.refetch = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          succeed = resolve;
        }),
    );
  render(
    <MemoryRouter initialEntries={["/session/caller/insights"]}>
      <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
      <Location />
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Open" });
  link.focus();
  fireEvent.keyDown(link, { key: "Enter" });
  expect(screen.getByText("Checking whether the task is available.").getAttribute("role")).toBe(
    "status",
  );
  expect(document.activeElement).toBe(screen.getByTitle("Checking task availability"));
  await act(async () => fail(new Error("offline")));
  expect(screen.getByText("The task is unavailable.").getAttribute("aria-live")).toBe("polite");
  const retry = screen.getByRole("button", { name: "Check again" });
  expect(document.activeElement).toBe(retry);
  fireEvent.click(retry);
  expect(document.activeElement).toBe(screen.getByTitle("Checking task availability"));
  await act(async () => succeed({ data: [entry], isError: false }));
  expect(screen.getByText("The task is available.").getAttribute("role")).toBe("status");
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Open" }));
  expect(screen.getByLabelText("route").textContent).toBe("/session/caller/insights");
});

it("does not steal focus if the user moves elsewhere while a check is pending", async () => {
  state.entries = [entry];
  let finish!: (value: { data: ManagedSessionSummary[]; isError: boolean }) => void;
  state.refetch = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const app = () => (
    <MemoryRouter>
      <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
      <button>Elsewhere</button>
    </MemoryRouter>
  );
  const view = render(app());
  const link = screen.getByRole("link", { name: "Open" });
  link.focus();
  fireEvent.keyDown(link, { key: "Enter" });
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  elsewhere.focus();
  state.entries = [];
  view.rerender(app());
  expect(document.activeElement).toBe(elsewhere);
  await act(async () => finish({ data: [], isError: false }));
  expect(document.activeElement).toBe(elsewhere);
});

it("restores retry focus when the recheck resolves immediately", async () => {
  state.entries = [];
  render(
    <MemoryRouter>
      <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
    </MemoryRouter>,
  );
  const retry = screen.getByRole("button", { name: "Check again" });
  retry.focus();
  state.entries = [entry];
  await act(async () => fireEvent.click(retry));
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "Open" }));
});

it("retains focus when activation fails immediately", async () => {
  state.entries = [entry];
  state.refetch = vi.fn().mockRejectedValueOnce(new Error("offline"));
  render(
    <MemoryRouter>
      <MarkdownTaskReference id={id}>Open</MarkdownTaskReference>
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Open" });
  link.focus();
  await act(async () => {
    fireEvent.keyDown(link, { key: "Enter" });
  });
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Check again" }));
});
