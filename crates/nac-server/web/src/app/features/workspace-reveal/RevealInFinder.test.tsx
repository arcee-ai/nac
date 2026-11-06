/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { queryKeys } from "@/app/services/queries";
import { api } from "@/app/services/api";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";
import { RevealInFinder } from "./RevealInFinder";
import { localRevealRoot } from "./model";

const snapshot = {
  metadata: { session_id: "local", workspace_host_path: "/tmp/日本語 space" },
  workspace: { host_root: "/tmp/日本語 space" },
} as SessionSnapshotResponse;
const origin = (path: string) => ({
  sessionId: "local",
  selectedRoot: "/tmp/日本語 space",
  pathRoot: "/tmp/日本語 space",
  path,
});
const entries = [
  { summary: { session_id: "local", sandboxed: false, ssh_host: null } },
] as ManagedSessionSummary[];

beforeEach(() =>
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  })),
);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("requires a matching current snapshot and explicit Local summary, including mounted Podman exclusion", () => {
  expect(localRevealRoot("local", snapshot, entries)).toBe("/tmp/日本語 space");
  expect(localRevealRoot("other", snapshot, entries)).toBeNull();
  expect(localRevealRoot("local", snapshot, undefined)).toBeNull();
  expect(localRevealRoot("local", null, entries)).toBeNull();
  for (const summary of [
    { ...entries[0]!.summary, sandboxed: true },
    { ...entries[0]!.summary, ssh_host: "remote" },
  ])
    expect(localRevealRoot("local", snapshot, [{ summary } as ManagedSessionSummary])).toBeNull();
  expect(
    localRevealRoot(
      "local",
      { ...snapshot, workspace: { ...snapshot.workspace!, host_root: "/changed" } },
      entries,
    ),
  ).toBeNull();
});

function fixture(native = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.sessions(false), entries);
  const runtime = {
    ...standaloneRuntime,
    nativeDirectory: native ? { chooseDirectory: async () => null } : undefined,
  };
  const wrapper = ({ children }: { children: import("react").ReactNode }) => (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </RuntimeContext.Provider>
  );
  const view = render(
    <RevealInFinder
      sessionId="local"
      snapshot={snapshot}
      path="one.txt"
      origin={origin("one.txt")}
    />,
    {
      wrapper,
    },
  );
  return { view, client };
}

it("leaves ordinary browsers inert without installing an extra session fetch", () => {
  const list = vi.spyOn(api, "listSessions");
  const { view, client } = fixture(false);
  try {
    expect(screen.queryByRole("button", { name: "Reveal in Finder" })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("binds one reveal to its selected file and aborts it on replacement without replay", async () => {
  const pending = Promise.withResolvers<{ opened: string; fell_back_to_parent: boolean }>();
  const reveal = vi.spyOn(api, "revealWorkspacePath").mockImplementation(() => pending.promise);
  const { view, client } = fixture();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(reveal).toHaveBeenCalledOnce();
    const signal = reveal.mock.calls[0]![4]!;
    expect(reveal.mock.calls[0]!.slice(0, 4)).toEqual([
      "local",
      "one.txt",
      "/tmp/日本語 space",
      "/tmp/日本語 space",
    ]);
    view.rerender(
      <RevealInFinder
        sessionId="local"
        snapshot={snapshot}
        path="two.txt"
        origin={origin("two.txt")}
      />,
    );
    expect(signal.aborted).toBe(true);
    pending.reject(new Error("late failure"));
    await waitFor(() => expect(screen.queryByText("late failure")).toBeNull());
    expect(reveal).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("reports a rejection and permits only an explicit subsequent invocation", async () => {
  const reveal = vi
    .spyOn(api, "revealWorkspacePath")
    .mockRejectedValue(new Error("Workspace changed"));
  const { view, client } = fixture();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    expect(await screen.findByText("Workspace changed")).toBeTruthy();
    expect(reveal).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("aborts a pending request when explicit reselection changes only its coordinate root", async () => {
  const pending = Promise.withResolvers<{ opened: string; fell_back_to_parent: boolean }>();
  const reveal = vi.spyOn(api, "revealWorkspacePath").mockImplementation(() => pending.promise);
  const { view, client } = fixture();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Reveal in Finder" }));
    const signal = reveal.mock.calls[0]![4]!;
    view.rerender(
      <RevealInFinder
        sessionId="local"
        snapshot={snapshot}
        path="one.txt"
        origin={{ ...origin("one.txt"), pathRoot: "/tmp" }}
      />,
    );
    expect(signal.aborted).toBe(true);
    pending.reject(new Error("old coordinate failure"));
    await waitFor(() => expect(screen.queryByText("old coordinate failure")).toBeNull());
    expect(reveal).toHaveBeenCalledOnce();
  } finally {
    view.unmount();
    client.clear();
  }
});

it("hides an unbound or stale selection instead of reinterpreting its path", () => {
  const { view, client } = fixture();
  try {
    for (const selectedOrigin of [
      null,
      { ...origin("one.txt"), sessionId: "other" },
      { ...origin("one.txt"), selectedRoot: "/changed" },
      origin("other.txt"),
    ]) {
      view.rerender(
        <RevealInFinder
          sessionId="local"
          snapshot={snapshot}
          path="one.txt"
          origin={selectedOrigin}
        />,
      );
      expect(screen.queryByRole("button", { name: "Reveal in Finder" })).toBeNull();
    }
  } finally {
    view.unmount();
    client.clear();
  }
});
