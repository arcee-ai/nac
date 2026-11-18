/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DelegatedWorkView } from "@/app/components/inspector/DelegatedWorkView";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { purgeAll as purgeDrafts } from "@/app/store/promptDraftStore";
import { release as releaseLayout, showSidePanelList } from "@/app/store/sessionLayoutStore";
import { queryKeys } from "@/app/services/queries";
import type { TraditionalChildRecord } from "@/app/types/api";

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

const child: TraditionalChildRecord = {
  child_session_id: "child-1",
  parent_session_id: "parent",
  root_session_id: "parent",
  profile: "general",
  description: "Review permissions",
  nesting_depth: 1,
  status: "running",
  generation: 2,
  run_id: "child-run",
  execution_mode: "background",
  report: null,
  failure: null,
  change_summary: null,
  verification_summary: null,
  completion_inbox_id: null,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  version: 3,
};

const listChildren = vi.spyOn(api, "listTraditionalChildren");
const startChild = vi.spyOn(api, "startTraditionalChild");
const cancelChild = vi.spyOn(api, "cancelTraditionalChild");

function mount(
  behavior: "direct",
  seed = true,
  orchestrationEnabled = true,
  { tablet = false, mobile = false }: { tablet?: boolean; mobile?: boolean } = {},
) {
  window.matchMedia = (query: string) =>
    ({
      matches:
        (tablet && query.startsWith("(min-width: 768px)")) ||
        (mobile && query === "(max-width: 767.98px)"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (seed) {
    client.setQueryData(queryKeys.traditionalChildren("parent"), [child]);
  }
  const tree = (parent: string, _enabled: boolean) => (
    <QueryClientProvider client={client}>
      <>
        <MemoryRouter initialEntries={[`/sessions/${parent}`]}>
          <Routes>
            <Route
              path="*"
              element={
                <ToastProvider>
                  <DelegatedWorkView sessionId={parent} behavior={behavior} />
                  <Location />
                </ToastProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </>
    </QueryClientProvider>
  );
  let view = render(tree("parent", orchestrationEnabled));
  return Object.assign(client, {
    /** Shows another parent's panel, or the same one under another policy. */
    show: (parent: string, enabled = orchestrationEnabled) => view.rerender(tree(parent, enabled)),
    /** Leaves the panel entirely, as opening a transcript does, then comes back. */
    remount: () => {
      view.unmount();
      view = render(tree("parent", orchestrationEnabled));
    },
  });
}

function draftBox(name: "Send a message") {
  return screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
}

function deferred<T>() {
  let resolve = (_: T) => {};
  let reject = (_: Error) => {};
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  listChildren.mockReset().mockResolvedValue([child]);
  startChild.mockReset().mockResolvedValue(child);
  cancelChild.mockReset().mockResolvedValue({ ...child, status: "cancelled" });
});
afterEach(() => {
  cleanup();
  purgeDrafts();
  releaseLayout();
});

describe("delegated work", () => {
  it("keeps the phone child name dialog read-only and restores its trigger without losing the draft", async () => {
    mount("direct", true, true, { mobile: true });
    act(() => showSidePanelList(false));
    const heading = await screen.findByRole("button", {
      name: "View full name: Review permissions",
    });
    fireEvent.change(draftBox("Send a message"), { target: { value: "Keep this child draft" } });
    const draft = draftBox("Send a message");
    act(() => heading.focus());
    fireEvent.click(heading, { detail: 0 });
    expect(screen.getByRole("dialog").querySelector("[data-full-session-name]")?.textContent).toBe(
      "Review permissions",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(draftBox("Send a message")).toBe(draft);
    expect(draft.value).toBe("Keep this child draft");
    expect(screen.getByTestId("location").textContent).toBe("/sessions/parent");
    expect(startChild).not.toHaveBeenCalled();
    expect(cancelChild).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("location").textContent).toBe("/session/child-1/insights");
  });

  it("groups this chat's running and settled agents without navigating on selection", async () => {
    const client = mount("direct");
    act(() =>
      client.setQueryData(queryKeys.traditionalChildren("parent"), [
        child,
        {
          ...child,
          child_session_id: "failed",
          description: "Failed audit",
          status: "failed",
          failure: "Broken",
        },
        { ...child, child_session_id: "idle", description: "Idle audit", status: "idle" },
      ]),
    );
    expect(screen.getByText("Agents in this chat")).toBeTruthy();
    expect(screen.getByText("Active (1)")).toBeTruthy();
    expect(await screen.findByText("Finished")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Idle audit" })).toBeTruthy();
    expect(screen.getAllByText("Idle").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Failed audit" }).getAttribute("aria-description"),
    ).toContain("Failed");
    fireEvent.click(screen.getByRole("button", { name: "Failed audit" }));
    expect(screen.getByTestId("location").textContent).toBe("/sessions/parent");
    expect(screen.getByRole("button", { name: "Failed audit" }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("navigates from a delegated row to its transcript", () => {
    mount("direct");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("location").textContent).toBe("/session/child-1/insights");
    expect(screen.queryByRole("button", { name: "New Orchestrator" })).toBeNull();
  });

  it("keeps a recoverable retry entry point after a relationship-list failure", async () => {
    listChildren.mockRejectedValueOnce(new Error("temporary failure")).mockResolvedValue([child]);
    mount("direct", false);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Subagents could not be loaded",
    );
    expect(screen.queryByText("No subagents yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy(),
    );
    expect(listChildren).toHaveBeenCalledTimes(2);
  });

  it("routes topology-specific steering, continuation, and cancellation to the parent", async () => {
    mount("direct");

    fireEvent.change(screen.getByRole("textbox", { name: "Send a message" }), {
      target: { value: "Check the remembered grant." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() =>
      expect(startChild).toHaveBeenCalledWith("parent", {
        profile: "general",
        child_session_id: "child-1",
        description: "Review permissions",
        prompt: "Check the remembered grant.",
        background: true,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(cancelChild).toHaveBeenCalledWith("parent", "child-1"));
  });

  it("renders cache-driven polling transitions without a page refresh", async () => {
    const client = mount("direct");
    expect(screen.getAllByText("Running in the background").length).toBeGreaterThan(0);

    act(() => {
      client.setQueryData(queryKeys.traditionalChildren("parent"), [
        {
          ...child,
          status: "completed",
          report: "The permissions audit passed.",
          completion_inbox_id: 12,
        },
      ]);
    });

    await waitFor(() => expect(screen.getByText("The permissions audit passed.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});

it("offers no way to start a subagent when there are none", async () => {
  listChildren.mockResolvedValue([]);
  mount("direct", false);

  expect(await screen.findByText("No subagents yet")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "New Agent" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New Orchestrator" })).toBeNull();
  expect(startChild).not.toHaveBeenCalled();
});

it("does not claim there are no subagents while the lists are loading", async () => {
  listChildren.mockReturnValue(new Promise(() => {}));
  mount("direct", false);

  expect(await screen.findByText("Loading subagents…")).toBeTruthy();
  expect(screen.queryByText("No subagents yet")).toBeNull();
  expect(screen.queryByText(/Active \(/)).toBeNull();
});

describe("selection and drafts", () => {
  const second: TraditionalChildRecord = {
    ...child,
    child_session_id: "child-2",
    description: "Audit the cache",
    status: "completed",
    updated_at: "2026-08-24T00:00:00Z",
  };

  it("brings back a nondefault child and its draft after leaving for a transcript", async () => {
    listChildren.mockResolvedValue([child, second]);
    const client = mount("direct");
    client.setQueryData(queryKeys.traditionalChildren("parent"), [child, second]);
    fireEvent.click(await screen.findByRole("button", { name: "Audit the cache" }));
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Rerun the cache audit" },
    });

    act(() => client.remount());

    expect(draftBox("Send a message").value).toBe("Rerun the cache audit");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(startChild).toHaveBeenCalledWith(
        "parent",
        expect.objectContaining({
          child_session_id: "child-2",
          prompt: "Rerun the cache audit",
        }),
      ),
    );
  });

  it("keeps the draft when the selected subagent finishes and the composer remounts", async () => {
    const client = mount("direct");
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Also check grants" },
    });

    act(() => {
      client.setQueryData(queryKeys.traditionalChildren("parent"), [
        { ...child, status: "completed", report: "Done.", version: 4 },
      ]);
    });

    // Status updates preserve the existing composer and its draft.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    expect(draftBox("Send a message").value).toBe("Also check grants");
  });

  it("takes a sent steer out of the field and never replays it across a transcript round trip", async () => {
    const reply = deferred<TraditionalChildRecord>();
    startChild.mockReturnValueOnce(reply.promise);
    const client = mount("direct");
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Check the grant" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledOnce());
    expect(draftBox("Send a message").value).toBe("");

    act(() => client.remount());

    // The field is free for the next message while the first is still pending.
    expect(draftBox("Send a message").value).toBe("");
    expect(draftBox("Send a message").disabled).toBe(false);
    fireEvent.keyDown(draftBox("Send a message"), { key: "Enter" });
    expect(startChild).toHaveBeenCalledOnce();
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Also check the cache" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledTimes(2));
    expect(startChild.mock.calls.map(([, payload]) => payload.prompt)).toEqual([
      "Check the grant",
      "Also check the cache",
    ]);

    await act(async () => reply.resolve(child));
    expect(startChild).toHaveBeenCalledTimes(2);
    expect(draftBox("Send a message").value).toBe("");
  });

  it.each([0, 1, 2])(
    "keeps repeated Steer activation separate from Stop (detail %s)",
    async (detail) => {
      const reply = deferred<TraditionalChildRecord>();
      startChild.mockReturnValue(reply.promise);
      mount("direct");
      fireEvent.change(draftBox("Send a message"), {
        target: { value: "Check the grant" },
      });
      const button = screen.getByRole("button", { name: "Steer" });
      fireEvent.click(button, { detail });
      // Send keeps its identity/position and becomes disabled; cancellation has its own control.
      expect(screen.getByRole("button", { name: "Steer" })).toBe(button);
      fireEvent.click(button, { detail });
      fireEvent.submit(button.closest("form")!);
      await waitFor(() => expect(startChild).toHaveBeenCalledOnce());
      expect(cancelChild).not.toHaveBeenCalled();

      // An intentional click on the distinct Stop works while steering is pending.
      fireEvent.click(screen.getByRole("button", { name: "Stop" }), {
        detail: 1,
      });
      await waitFor(() => expect(cancelChild).toHaveBeenCalledWith("parent", "child-1"));
      await act(async () => reply.resolve(child));
      expect(startChild).toHaveBeenCalledOnce();
    },
  );

  it("holds a second continuation until the target runs, then lets the next message steer", async () => {
    const finished = {
      ...child,
      status: "completed" as const,
      report: "Done.",
      version: 4,
    };
    const reply = deferred<TraditionalChildRecord>();
    startChild.mockReturnValueOnce(reply.promise);
    const client = mount("direct");
    client.setQueryData(queryKeys.traditionalChildren("parent"), [finished]);
    fireEvent.change(await waitFor(() => draftBox("Send a message")), {
      target: { value: "Run it again" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledOnce());

    // Not running yet: a second start would race the first.
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "And the cache" },
    });
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
    fireEvent.keyDown(draftBox("Send a message"), { key: "Enter" });
    expect(startChild).toHaveBeenCalledOnce();

    act(() => {
      client.setQueryData(queryKeys.traditionalChildren("parent"), [
        { ...finished, status: "running", generation: 3, version: 5 },
      ]);
    });
    // A fresh composer for the newer run keeps the next message and lets it steer.
    await screen.findByRole("button", { name: "Stop" });
    const box = draftBox("Send a message");
    expect(box.value).toBe("And the cache");
    expect(box.disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledTimes(2));
    expect(startChild.mock.calls.map(([, payload]) => payload.prompt)).toEqual([
      "Run it again",
      "And the cache",
    ]);
    expect(screen.getByRole("button", { name: "Stop" })).toHaveProperty("disabled", false);

    await act(async () => reply.resolve({ ...finished, status: "completed", generation: 3 }));
    expect(startChild).toHaveBeenCalledTimes(2);
  });

  it("lets another subagent send while one request is pending, without replaying it", async () => {
    listChildren.mockResolvedValue([child, second]);
    const reply = deferred<TraditionalChildRecord>();
    startChild.mockReturnValueOnce(reply.promise);
    const client = mount("direct");
    client.setQueryData(queryKeys.traditionalChildren("parent"), [child, second]);
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Check the grant" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledOnce());

    fireEvent.click(await screen.findByRole("button", { name: "Audit the cache" }));
    expect(draftBox("Send a message").value).toBe("");
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Rerun the cache audit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledTimes(2));
    expect(startChild.mock.calls.map(([, payload]) => payload.child_session_id)).toEqual([
      "child-1",
      "child-2",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Review permissions" }));
    expect(draftBox("Send a message").value).toBe("");
    await act(async () => reply.resolve(child));
    expect(startChild).toHaveBeenCalledTimes(2);
  });

  it("preserves an unconfirmed message separately and sends it again only after explicit recovery", async () => {
    const reply = deferred<TraditionalChildRecord>();
    startChild.mockReturnValueOnce(reply.promise);
    const client = mount("direct");
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Check the grant" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledOnce());
    act(() => client.remount());

    await act(async () => reply.reject(new Error("busy")));

    expect(draftBox("Send a message").value).toBe("");
    expect(screen.getByText(/Message delivery is unconfirmed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore to composer" }));
    expect(draftBox("Send a message").value).toBe("Check the grant");
    expect(startChild).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(draftBox("Send a message").value).toBe(""));
  });

  it("keeps a message written while a send is pending, whichever way the send ends", async () => {
    const accepted = deferred<TraditionalChildRecord>();
    const rejected = deferred<TraditionalChildRecord>();
    startChild.mockReturnValueOnce(accepted.promise).mockReturnValueOnce(rejected.promise);
    mount("direct");
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "First" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Second" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledTimes(2));
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Unsent" },
    });

    await act(async () => accepted.resolve(child));
    expect(draftBox("Send a message").value).toBe("Unsent");
    await act(async () => rejected.reject(new Error("busy")));
    expect(draftBox("Send a message").value).toBe("Unsent");
    expect(screen.getByText("Second")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore to composer" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(startChild).toHaveBeenCalledTimes(2);
  });

  it.each(["child"] as const)(
    "ignores an older %s foreground response after a newer generation",
    async (_mode) => {
      const client = mount("direct");
      const reply = deferred<TraditionalChildRecord>();
      startChild.mockReturnValueOnce(reply.promise);
      fireEvent.change(draftBox("Send a message"), { target: { value: "Steer" } });
      fireEvent.click(screen.getByRole("button", { name: "Steer" }));
      await waitFor(() => expect(startChild).toHaveBeenCalledOnce());
      const newer = { ...child, generation: 3, version: 8 };
      act(() => client.setQueryData(queryKeys.traditionalChildren("parent"), [newer]));
      await act(async () => reply.resolve({ ...child, status: "completed", version: 4 }));
      expect(client.getQueryData(queryKeys.traditionalChildren("parent"))).toEqual([newer]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
        expect(screen.queryByText("Sending message…")).toBeNull();
      });
    },
  );

  it.each(["child"] as const)(
    "does not rewind a %s record when an older poll completes",
    async (_mode) => {
      const client = mount("direct");
      const poll = deferred<TraditionalChildRecord[]>();
      listChildren.mockReturnValueOnce(poll.promise);
      const refresh = client.refetchQueries({
        queryKey: queryKeys.traditionalChildren("parent"),
      });
      const newer = { ...child, generation: 3, version: 8 };
      act(() => client.setQueryData(queryKeys.traditionalChildren("parent"), [newer]));
      await act(async () => {
        poll.resolve([child]);
        await refresh;
      });
      expect(client.getQueryData(queryKeys.traditionalChildren("parent"))).toEqual([newer]);
    },
  );

  it("keeps a selection and a draft per parent", async () => {
    listChildren.mockImplementation(async (parent) =>
      parent === "parent"
        ? [child, second]
        : [
            {
              ...second,
              child_session_id: "child-3",
              parent_session_id: "other",
            },
          ],
    );
    const client = mount("direct");
    act(() => {
      client.setQueryData(queryKeys.traditionalChildren("parent"), [child, second]);
      client.setQueryData(queryKeys.traditionalChildren("other"), [
        { ...second, child_session_id: "child-3", parent_session_id: "other" },
      ]);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Audit the cache" }));
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "For child two" },
    });

    act(() => client.show("other"));
    expect(draftBox("Send a message").value).toBe("");
    act(() => client.show("parent"));

    // Child two is finished, so its composer sends where the newest child's steers.
    expect(draftBox("Send a message").value).toBe("For child two");
  });

  it("stands in the newest subagent for a vanished one without moving its draft", async () => {
    let listed = [child, second];
    listChildren.mockImplementation(async () => listed);
    const client = mount("direct", false);
    const refresh = (next: TraditionalChildRecord[]) => {
      listed = next;
      return act(() =>
        client.refetchQueries({
          queryKey: queryKeys.traditionalChildren("parent"),
        }),
      );
    };
    fireEvent.click(await screen.findByRole("button", { name: "Audit the cache" }));
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "Only for child two" },
    });

    await refresh([child]);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Audit the cache" })).toBeNull(),
    );
    expect(draftBox("Send a message").value).toBe("");
    fireEvent.change(draftBox("Send a message"), {
      target: { value: "For child one" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() => expect(startChild).toHaveBeenCalledOnce());
    expect(startChild.mock.calls[0][1]).toMatchObject({
      child_session_id: "child-1",
      prompt: "For child one",
    });

    // The choice was kept, so the subagent and its draft return with it.
    await refresh([child, second]);
    await waitFor(() => expect(draftBox("Send a message").value).toBe("Only for child two"));
    expect(startChild).toHaveBeenCalledOnce();
  });
});

describe("load state in the narrow list", () => {
  it("offers the retry from a tablet list opened over a failed load", async () => {
    listChildren.mockRejectedValueOnce(new Error("503")).mockResolvedValue([child]);
    mount("direct", false, true, { tablet: true });
    await screen.findByRole("alert");
    act(() => showSidePanelList(true));

    expect(screen.getByRole("alert").textContent).toContain("Subagents could not be loaded");
    expect(screen.queryByText("No subagents yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Review permissions" })).toBeTruthy();
  });

  it("says the lists are loading in a tablet list opened before they answer", async () => {
    listChildren.mockReturnValue(new Promise(() => {}));
    mount("direct", false, true, { tablet: true });
    act(() => showSidePanelList(true));

    expect(await screen.findByText("Loading subagents…")).toBeTruthy();
    expect(screen.queryByText("No subagents yet")).toBeNull();
  });

  it("keeps loaded rows when a later poll fails", async () => {
    const client = mount("direct");
    listChildren.mockRejectedValue(new Error("503"));
    await act(() =>
      client.refetchQueries({
        queryKey: queryKeys.traditionalChildren("parent"),
      }),
    );

    expect(client.getQueryState(queryKeys.traditionalChildren("parent"))?.status).toBe("error");
    expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy();
    expect(await screen.findByText(/Showing available agents/)).toBeTruthy();
    expect(screen.queryByText(/Active \(/)).toBeNull();
  });
});
