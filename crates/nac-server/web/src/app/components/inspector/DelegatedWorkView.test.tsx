/** @vitest-environment jsdom */

import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { ORCHESTRATION_UI_POLICY, DIRECT_UI_POLICY } from "@/app/features/ui-policy/policy";
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
import type { ManagedOrchestratorRecord, TraditionalChildRecord } from "@/app/types/api";

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

const orchestrator: ManagedOrchestratorRecord = {
  orchestrator_session_id: "orchestrator-1",
  parent_session_id: "parent",
  root_session_id: "parent",
  description: "Run the compatibility audit",
  status: "completed",
  generation: 1,
  run_id: "orchestrator-run",
  execution_mode: "foreground",
  report: "done",
  failure: null,
  completion_inbox_id: 4,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  version: 2,
};

const listChildren = vi.spyOn(api, "listTraditionalChildren");
const listOrchestrators = vi.spyOn(api, "listManagedOrchestrators");
const startChild = vi.spyOn(api, "startTraditionalChild");
const cancelChild = vi.spyOn(api, "cancelTraditionalChild");
const startOrchestrator = vi.spyOn(api, "startManagedOrchestrator");
const cancelOrchestrator = vi.spyOn(api, "cancelManagedOrchestrator");

function mount(
  behavior: "direct" | "direct-with-orchestrator",
  seed = true,
  orchestrationEnabled = true,
  { tablet = false }: { tablet?: boolean } = {},
) {
  window.matchMedia = (query: string) =>
    ({
      matches: tablet && query.startsWith("(min-width: 768px)"),
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
    client.setQueryData(queryKeys.managedOrchestrators("parent"), [orchestrator]);
  }
  const tree = (parent: string, enabled: boolean) => (
    <QueryClientProvider client={client}>
      <UiPolicyContext.Provider value={enabled ? ORCHESTRATION_UI_POLICY : DIRECT_UI_POLICY}>
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
      </UiPolicyContext.Provider>
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

function draftBox(name: "Steer a message" | "Send a message") {
  return screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
}

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  listChildren.mockReset().mockResolvedValue([child]);
  listOrchestrators.mockReset().mockResolvedValue([orchestrator]);
  startChild.mockReset().mockResolvedValue(child);
  cancelChild.mockReset().mockResolvedValue({ ...child, status: "cancelled" });
  startOrchestrator.mockReset().mockResolvedValue(orchestrator);
  cancelOrchestrator.mockReset().mockResolvedValue({ ...orchestrator, status: "cancelled" });
});
afterEach(() => {
  cleanup();
  purgeDrafts();
  releaseLayout();
});

describe("delegated work", () => {
  it("keeps coding agents and managed orchestrators visibly distinct", () => {
    mount("direct-with-orchestrator");

    expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run the compatibility audit" })).toBeTruthy();
    expect(screen.getAllByText("Running in the background").length).toBeGreaterThan(0);
  });

  it("navigates from a delegated row to its transcript", () => {
    mount("direct");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("location").textContent).toBe("/session/child-1/files");
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
    mount("direct-with-orchestrator");

    fireEvent.change(screen.getByRole("textbox", { name: "Steer a message" }), {
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

    fireEvent.click(screen.getByRole("button", { name: "Run the compatibility audit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Send a message" }), {
      target: { value: "Run the next audit generation." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(startOrchestrator).toHaveBeenCalledWith("parent", {
        orchestrator_session_id: "orchestrator-1",
        description: "Run the compatibility audit",
        prompt: "Run the next audit generation.",
        background: false,
      }),
    );
    expect(cancelOrchestrator).not.toHaveBeenCalled();
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

    await waitFor(() => expect(screen.getByText("Completed")).toBeTruthy());
    expect(screen.getByText("The permissions audit passed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});

it("hides cached managed relationships while retaining children", async () => {
  mount("direct-with-orchestrator", true, false);
  expect(screen.queryByRole("button", { name: "Run the compatibility audit" })).toBeNull();
  expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy();
  await waitFor(() => expect(listOrchestrators).not.toHaveBeenCalled());
});

it("offers no way to start a subagent when there are none", async () => {
  listChildren.mockResolvedValue([]);
  listOrchestrators.mockResolvedValue([]);
  mount("direct-with-orchestrator", false);

  expect(await screen.findByText("No subagents yet")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "New Agent" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New Orchestrator" })).toBeNull();
  expect(startChild).not.toHaveBeenCalled();
  expect(startOrchestrator).not.toHaveBeenCalled();
});

it("keeps the selected subagent and its draft when another one updates", async () => {
  const client = mount("direct-with-orchestrator");
  fireEvent.click(screen.getByRole("button", { name: "Run the compatibility audit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Send a message" }), {
    target: { value: "Half-written follow-up" },
  });

  act(() => {
    client.setQueryData(queryKeys.traditionalChildren("parent"), [
      { ...child, report: "Still going.", updated_at: "2026-08-26T00:00:00Z", version: 4 },
    ]);
  });

  await waitFor(() =>
    expect(
      (screen.getByRole("textbox", { name: "Send a message" }) as HTMLTextAreaElement).value,
    ).toBe("Half-written follow-up"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() =>
    expect(startOrchestrator).toHaveBeenCalledWith(
      "parent",
      expect.objectContaining({ orchestrator_session_id: "orchestrator-1" }),
    ),
  );
  expect(startChild).not.toHaveBeenCalled();
});

it("does not claim there are no subagents while the lists are loading", async () => {
  listChildren.mockReturnValue(new Promise(() => {}));
  mount("direct-with-orchestrator", false);

  expect(await screen.findByText("Loading subagents…")).toBeTruthy();
  expect(screen.queryByText("No subagents yet")).toBeNull();
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
    fireEvent.change(draftBox("Send a message"), { target: { value: "Rerun the cache audit" } });

    act(() => client.remount());

    expect(draftBox("Send a message").value).toBe("Rerun the cache audit");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(startChild).toHaveBeenCalledWith(
        "parent",
        expect.objectContaining({ child_session_id: "child-2", prompt: "Rerun the cache audit" }),
      ),
    );
  });

  it("brings back a managed orchestrator and its draft after leaving for a transcript", () => {
    const client = mount("direct-with-orchestrator");
    fireEvent.click(screen.getByRole("button", { name: "Run the compatibility audit" }));
    fireEvent.change(draftBox("Send a message"), { target: { value: "Next audit pass" } });

    act(() => client.remount());

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(draftBox("Send a message").value).toBe("Next audit pass");
  });

  it("keeps the draft when the selected subagent finishes and the composer remounts", async () => {
    const client = mount("direct");
    fireEvent.change(draftBox("Steer a message"), { target: { value: "Also check grants" } });

    act(() => {
      client.setQueryData(queryKeys.traditionalChildren("parent"), [
        { ...child, status: "completed", report: "Done.", version: 4 },
      ]);
    });

    // The status is part of the composer's key, so this is a fresh composer.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    expect(draftBox("Send a message").value).toBe("Also check grants");
  });

  it("keeps a selection and a draft per parent", async () => {
    listChildren.mockImplementation(async (parent) =>
      parent === "parent"
        ? [child, second]
        : [{ ...second, child_session_id: "child-3", parent_session_id: "other" }],
    );
    const client = mount("direct");
    act(() => {
      client.setQueryData(queryKeys.traditionalChildren("parent"), [child, second]);
      client.setQueryData(queryKeys.traditionalChildren("other"), [
        { ...second, child_session_id: "child-3", parent_session_id: "other" },
      ]);
    });
    fireEvent.click(await screen.findByRole("button", { name: "Audit the cache" }));
    fireEvent.change(draftBox("Send a message"), { target: { value: "For child two" } });

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
        client.refetchQueries({ queryKey: queryKeys.traditionalChildren("parent") }),
      );
    };
    fireEvent.click(await screen.findByRole("button", { name: "Audit the cache" }));
    fireEvent.change(draftBox("Send a message"), { target: { value: "Only for child two" } });

    await refresh([child]);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Audit the cache" })).toBeNull(),
    );
    expect(draftBox("Steer a message").value).toBe("");
    fireEvent.change(draftBox("Steer a message"), { target: { value: "For child one" } });
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

  it("never shows or sends a policy-hidden orchestrator's draft as a child's", async () => {
    const client = mount("direct-with-orchestrator");
    fireEvent.click(screen.getByRole("button", { name: "Run the compatibility audit" }));
    fireEvent.change(draftBox("Send a message"), { target: { value: "Orchestrator only" } });

    act(() => client.show("parent", false));

    expect(screen.queryByRole("button", { name: "Run the compatibility audit" })).toBeNull();
    expect(draftBox("Steer a message").value).toBe("");
    expect(startChild).not.toHaveBeenCalled();
    expect(startOrchestrator).not.toHaveBeenCalled();

    act(() => client.show("parent", true));
    expect(draftBox("Send a message").value).toBe("Orchestrator only");
  });

  it("targets existing ids for orchestrator steering and stopping and child continuation", async () => {
    const running = { ...orchestrator, status: "running" as const };
    listChildren.mockResolvedValue([second]);
    listOrchestrators.mockResolvedValue([running]);
    startOrchestrator.mockResolvedValue(running);
    startChild.mockResolvedValue({ ...second, status: "running", generation: 3 });
    const client = mount("direct-with-orchestrator", false);
    client.setQueryData(queryKeys.traditionalChildren("parent"), [second]);
    client.setQueryData(queryKeys.managedOrchestrators("parent"), [
      { ...orchestrator, status: "running", updated_at: "2026-08-26T00:00:00Z" },
    ]);

    fireEvent.click(await screen.findByRole("button", { name: "Run the compatibility audit" }));
    fireEvent.change(draftBox("Steer a message"), { target: { value: "Narrow the audit" } });
    fireEvent.click(screen.getByRole("button", { name: "Steer" }));
    await waitFor(() =>
      expect(startOrchestrator).toHaveBeenCalledWith("parent", {
        orchestrator_session_id: "orchestrator-1",
        description: "Run the compatibility audit",
        prompt: "Narrow the audit",
        background: false,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(cancelOrchestrator).toHaveBeenCalledWith("parent", "orchestrator-1"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Audit the cache" }));
    fireEvent.change(draftBox("Send a message"), { target: { value: "Generation two" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(startChild).toHaveBeenCalledWith("parent", {
        profile: "general",
        child_session_id: "child-2",
        description: "Audit the cache",
        prompt: "Generation two",
        background: true,
      }),
    );
    expect(cancelChild).not.toHaveBeenCalled();
    // The accepted generation is running, so the cleared field may already say Steer.
    await waitFor(() =>
      expect(
        (screen.getByRole("textbox", { name: /^(Send|Steer) a message$/ }) as HTMLTextAreaElement)
          .value,
      ).toBe(""),
    );
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
    await act(() => client.refetchQueries({ queryKey: queryKeys.traditionalChildren("parent") }));

    expect(client.getQueryState(queryKeys.traditionalChildren("parent"))?.status).toBe("error");
    expect(screen.getByRole("button", { name: "Review permissions" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
