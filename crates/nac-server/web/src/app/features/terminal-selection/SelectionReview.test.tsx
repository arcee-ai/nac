/** @vitest-environment jsdom */
import { useSyncExternalStore } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNacClient } from "@/app/services/nacClient";
import type { NativeApi } from "@/app/services/api";
import type {
  TerminalSelectionPreviewResponse,
  TerminalSelectionSubmissionRequest,
  TerminalSelectionSubmissionResponse,
} from "@/app/types/api";
import { SelectionReview, type ReviewAvailability } from "./SelectionReview";
import { SelectionReviewController, type SelectionCapture } from "./reviewController";
import { useSelectionReview } from "./useSelectionReview";

import { TerminalWorkspace } from "./TerminalWorkspace";

const context = vi.hoisted(() => ({
  snapshot: undefined as undefined | { active_run?: { run_id: string } },
  sourceAlive: true,
  sourceUnavailable: false,
}));
vi.mock("@/app/services/queries", () => ({
  useSessionSnapshot: () => ({ data: context.snapshot, isError: false }),
}));
vi.mock("@/app/features/terminal/queries", () => ({
  useUserTerminalStatus: () => ({
    data: { alive: context.sourceAlive },
    isError: context.sourceUnavailable,
  }),
}));
vi.mock("@/app/features/terminal/TerminalPane", () => ({
  TerminalPane: ({
    onReviewSelection,
  }: {
    onReviewSelection: (capture: SelectionCapture) => void;
  }) => (
    <button type="button" onClick={() => onReviewSelection(capture)}>
      Review rendered capture
    </button>
  ),
}));

type PreviewRequest = Parameters<NativeApi["previewUserTerminalSelection"]>[2];
const owner = "721fac4b-8156-4b76-80de-fdb7abe0a122";
const firstRun = "a914c904-7cc8-4c0f-a2de-a6762bf9ba12";
const nextRun = "ce1a056f-104b-4057-a20b-f76bfaf5a231";
const original = " SECRET_VALUE\r\n/compact\n$skill ";
const canonical = " [REDACTED]\n/compact\n$skill ";
const capture: SelectionCapture = {
  sessionId: "session",
  terminalId: "shell",
  selectedText: original,
  capturedAtMs: "1000",
  sourceAlive: true,
};
function preview(body: PreviewRequest): Response {
  const user = body.user_text?.replaceAll("SECRET_VALUE", "[REDACTED]").replaceAll("\r\n", "\n");
  const result: TerminalSelectionPreviewResponse = {
    protocol_version: 1,
    source_kind: "user_supplied_rendered_selection",
    source_session_id: "session",
    terminal_id: "shell",
    owner_instance_id: owner,
    capture_id: body.capture_id,
    client_capture_time_ms: body.client_capture_time_ms,
    previewed_at_ms: "1001",
    text: canonical,
    user_text: user,
    input_utf8_bytes: original.length,
    input_scalars: original.length,
    text_utf8_bytes: canonical.length,
    text_scalars: canonical.length,
    max_utf8_bytes: 32768,
    max_scalars: 8192,
    controls_removed: 0,
    line_endings_normalized: 1,
    truncated: false,
  };
  return Response.json(result);
}
function receipt(body: TerminalSelectionSubmissionRequest, replayed = false): Response {
  const result: TerminalSelectionSubmissionResponse = {
    protocol_version: 1,
    admission_id: body.admission_id,
    inbox_id: "1",
    version: 0,
    status: "pending",
    replayed,
    current_delivery: body.delivery === "send" ? "queue" : body.delivery,
    current_target_run_id: body.expected_run_id,
    delivered_run_id: null,
    accepted_intent: {
      protocol_version: 1,
      source_kind: "user_supplied_rendered_selection",
      admission_id: body.admission_id,
      capture_id: body.capture_id,
      owner_instance_id: body.expected_owner_instance_id,
      source_session_id: "session",
      terminal_id: "shell",
      client_capture_time_ms: body.client_capture_time_ms,
      text: body.expected_selection_text,
      user_text: body.expected_user_text ?? null,
      initial_delivery: body.delivery,
      initial_expected_run_id: body.expected_run_id ?? null,
    },
  };
  return Response.json(result);
}
function wire(options: { lostAck?: boolean; previewFailure?: boolean } = {}) {
  const submissions: TerminalSelectionSubmissionRequest[] = [];
  const previews: PreviewRequest[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("selection-preview")) {
      previews.push(body);
      if (options.previewFailure) return Response.json({ error: "not found" }, { status: 404 });
      return preview(body);
    }
    if (String(url).endsWith("selection-submissions")) {
      submissions.push(body);
      if (options.lostAck && submissions.length === 1) throw new TypeError("lost ACK");
      return receipt(body, submissions.length > 1);
    }
    throw new Error("Unexpected transport operation");
  });
  return { fetch, submissions, previews };
}
const runtimes: NativeRuntime[] = [];
function runtime(fetch: typeof globalThis.fetch, host = "one") {
  const endpoint = `https://${host}.example/nac`;
  const value = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host,
      incarnation: host,
      endpoint,
      release: "test",
    },
    client: createNacClient({ endpoint, credentials: "omit", fetch }),
    storage: { getItem: () => null, setItem: vi.fn() },
  });
  value.stores.runtimeStore.resetRuntime("session");
  runtimes.push(value);
  return value;
}
function Harness({
  availability = { mode: "idle" },
  source = capture,
}: {
  availability?: ReviewAvailability;
  source?: SelectionCapture;
}) {
  const { controller, state } = useSelectionReview("session");
  return (
    <>
      <button
        type="button"
        onClick={() =>
          controller.capture(source, { delivery: availability.mode === "busy" ? "queue" : "send" })
        }
      >
        Capture review
      </button>
      <SelectionReview controller={controller} state={state} availability={availability} />
    </>
  );
}
function tree(
  value: NativeRuntime,
  availability: ReviewAvailability = { mode: "idle" },
  source = capture,
  workspace = false,
) {
  return (
    <MemoryRouter>
      <QueryClientProvider client={value.queryClient}>
        <RuntimeContext.Provider value={value}>
          {workspace ? (
            <TerminalWorkspace sessionId="session" />
          ) : (
            <Harness availability={availability} source={source} />
          )}
        </RuntimeContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}
function cached(value: NativeRuntime) {
  return JSON.stringify({
    queries: value.queryClient
      .getQueryCache()
      .getAll()
      .map((entry) => entry.state.data),
    mutations: value.queryClient
      .getMutationCache()
      .getAll()
      .map((entry) => entry.state),
  });
}
beforeEach(() => {
  context.snapshot = {};
  context.sourceAlive = true;
  context.sourceUnavailable = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(() => {
  cleanup();
  for (const value of runtimes.splice(0)) value.close();
});

describe("local terminal selection review through the real typed client", () => {
  it("mounts review from the pane capture and explicitly freezes a displayed run while runtime is busy", async () => {
    const net = wire();
    const value = runtime(net.fetch);
    context.snapshot = { active_run: { run_id: firstRun } };
    const view = render(tree(value, undefined, undefined, true));
    fireEvent.click(screen.getByRole("button", { name: "Review rendered capture" }));
    await screen.findByLabelText("Reviewed selected text");
    expect((screen.getByRole("radio", { name: /Queue after/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Steer the displayed/ }));
    context.snapshot = { active_run: { run_id: nextRun } };
    view.rerender(tree(value, undefined, undefined, true));
    expect(
      (screen.getByRole("button", { name: "Steer selected run" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: /Queue after/ }));
    fireEvent.click(screen.getByRole("button", { name: "Queue selection" }));
    await screen.findByText(/Selection admission accepted/);
    expect(net.submissions[0].delivery).toBe("queue");
    expect(net.submissions[0].expected_run_id).toBeUndefined();
  });
  it("keeps unknown runtime state conservative and fences unavailable sources before a new send", async () => {
    const net = wire();
    const value = runtime(net.fetch);
    context.snapshot = undefined;
    const view = render(tree(value, undefined, undefined, true));
    fireEvent.click(screen.getByRole("button", { name: "Review rendered capture" }));
    await screen.findByLabelText("Reviewed selected text");
    expect(
      (screen.getByRole("radio", { name: /Send as a new turn/ }) as HTMLInputElement).disabled,
    ).toBe(true);
    context.sourceUnavailable = true;
    view.rerender(tree(value, undefined, undefined, true));
    await screen.findByText(/source is currently unavailable/);
    expect(
      (screen.getByRole("button", { name: "Queue selection" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(net.submissions).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection review" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("previews only after capture, shows canonical literal text and never caches raw selection or submits on dismissal", async () => {
    const net = wire();
    const value = runtime(net.fetch);
    render(tree(value));
    expect(net.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByLabelText("Reviewed selected text");
    expect(screen.getByLabelText("Reviewed selected text").textContent).toBe(canonical);
    expect(document.body.textContent).not.toContain("SECRET_VALUE");
    expect(cached(value)).not.toContain("SECRET_VALUE");
    expect(value.queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(net.previews[0].selected_text).toBe(original);
    expect(net.submissions).toHaveLength(0);
    expect(net.fetch.mock.calls[0][0]).toBe(
      "https://one.example/nac/sessions/session/user-terminals/shell/selection-preview",
    );
    expect(net.fetch.mock.calls[0][1]?.credentials).toBe("omit");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss review" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(net.submissions).toHaveLength(0);
  });
  it("re-previews optional literal text and sends exactly the reviewed canonical fields only on explicit Send", async () => {
    const net = wire();
    const value = runtime(net.fetch);
    render(tree(value));
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByLabelText("Reviewed selected text");
    fireEvent.click(screen.getByRole("button", { name: "Edit accompanying text" }));
    fireEvent.change(screen.getByLabelText("Accompanying literal text (optional)"), {
      target: { value: " /goal SECRET_VALUE\r\n$skill " },
    });
    expect(
      (screen.getByRole("button", { name: "Send selection" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Update preview" }));
    const question = await screen.findByLabelText("Reviewed accompanying text");
    expect(question.textContent).toBe(" /goal [REDACTED]\n$skill ");
    expect(document.body.textContent).not.toContain("SECRET_VALUE");
    expect(net.submissions).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Send selection" }));
    await screen.findByText(/Selection admission accepted/);
    expect(net.submissions).toHaveLength(1);
    expect(net.submissions[0]).toMatchObject({
      original_selected_text: original,
      expected_selection_text: canonical,
      original_user_text: " /goal SECRET_VALUE\n$skill ",
      expected_user_text: " /goal [REDACTED]\n$skill ",
      delivery: "send",
      expected_owner_instance_id: owner,
    });
    expect(net.submissions[0].capture_id).toBe(net.previews[0].capture_id);
    expect(cached(value)).not.toContain("SECRET_VALUE");
  });
  it("clears the local draft and rejects oversized capture/edit without a truncated preview or agent operation", async () => {
    const net = wire();
    const value = runtime(net.fetch);
    const view = render(
      tree(value, { mode: "idle" }, { ...capture, selectedText: "x".repeat(8193) }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByText(/Nothing was truncated or sent/);
    expect(net.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry preview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection review" }));
    view.rerender(tree(value));
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByLabelText("Reviewed selected text");
    fireEvent.click(screen.getByRole("button", { name: "Edit accompanying text" }));
    fireEvent.change(screen.getByLabelText("Accompanying literal text (optional)"), {
      target: { value: "🙂".repeat(8193) },
    });
    await screen.findByText(/That edit was rejected without truncation/);
    expect(
      (screen.getByLabelText("Accompanying literal text (optional)") as HTMLTextAreaElement).value,
    ).toBe("");
    expect(net.previews).toHaveLength(1);
    expect(net.submissions).toHaveLength(0);
  });
  it("offers explicit queue or exact-run steer while busy and does not silently retarget a changed run", async () => {
    const net = wire();
    const value = runtime(net.fetch);
    const view = render(tree(value, { mode: "busy", runId: firstRun }));
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByLabelText("Reviewed selected text");
    expect(
      (screen.getByRole("radio", { name: /Send as a new turn/ }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("radio", { name: /Queue after/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("radio", { name: /Steer the displayed/ }));
    view.rerender(tree(value, { mode: "unknown", runId: firstRun }));
    expect(
      (screen.getByRole("button", { name: "Steer selected run" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    view.rerender(tree(value, { mode: "busy", runId: nextRun }));
    await screen.findByText(/will not be retargeted automatically/);
    expect(
      (screen.getByRole("button", { name: "Steer selected run" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(net.submissions).toHaveLength(0);
    fireEvent.click(screen.getByRole("radio", { name: /Steer the displayed/ }));
    fireEvent.click(screen.getByRole("button", { name: "Steer selected run" }));
    await screen.findByText(/Selection admission accepted/);
    expect(net.submissions[0].delivery).toBe("steer");
    expect(net.submissions[0].expected_run_id).toBe(nextRun);
  });
  it("submits an explicitly queued snapshot while its source has exited", async () => {
    const net = wire();
    const value = runtime(net.fetch);
    render(
      tree(
        value,
        { mode: "busy", runId: firstRun, sourceAlive: false },
        { ...capture, sourceAlive: false },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByText(/source shell has exited/);
    await screen.findByLabelText("Reviewed selected text");
    fireEvent.click(screen.getByRole("button", { name: "Queue selection" }));
    await screen.findByText(/Selection admission accepted/);
    expect(net.submissions[0].delivery).toBe("queue");
    expect(net.submissions[0].expected_run_id).toBeUndefined();
  });
  it("never automatically retries uncertainty and manually reconciles the same immutable admission even after source/run expiry", async () => {
    const net = wire({ lostAck: true });
    const value = runtime(net.fetch);
    const view = render(tree(value, { mode: "busy", runId: firstRun }));
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByLabelText("Reviewed selected text");
    fireEvent.click(screen.getByRole("radio", { name: /Steer the displayed/ }));
    fireEvent.click(screen.getByRole("button", { name: "Steer selected run" }));
    await screen.findByText(/Submission was not confirmed/);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(net.submissions).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Edit accompanying text" })).toBeNull();
    view.rerender(tree(value, { mode: "idle", sourceUnavailable: true, sourceAlive: false }));
    fireEvent.click(screen.getByRole("button", { name: "Retry same submission" }));
    await screen.findByText(/Existing admission reconciled/);
    expect(net.submissions).toHaveLength(2);
    expect(net.submissions[1]).toEqual(net.submissions[0]);
    expect(net.submissions[1].expected_run_id).toBe(firstRun);
  });
  it("keeps failed/opaque previews local with no send or automatic preview retry", async () => {
    const net = wire({ previewFailure: true });
    const value = runtime(net.fetch);
    render(tree(value));
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByText(/Nothing was sent/);
    expect(net.fetch).toHaveBeenCalledTimes(1);
    expect(net.submissions).toHaveLength(0);
    expect(
      (screen.getByRole("button", { name: "Send selection" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection review" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("discards a pending raw draft on consumer replacement and ignores the old preview even if transport resolves late", async () => {
    let resolve!: (value: Response) => void;
    let body!: PreviewRequest;
    const oldFetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Promise((done) => {
        resolve = done;
      });
    });
    const first = runtime(oldFetch);
    const net = wire();
    const replacement = runtime(net.fetch, "two");
    const view = render(tree(first));
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByText(/Preparing the server-normalized preview/);
    await waitFor(() => expect(oldFetch).toHaveBeenCalledTimes(1));
    view.rerender(tree(replacement));
    await act(async () => {
      resolve(preview(body));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(net.fetch).not.toHaveBeenCalled();
    expect(cached(replacement)).not.toContain("SECRET_VALUE");
    fireEvent.click(screen.getByRole("button", { name: "Capture review" }));
    await screen.findByLabelText("Reviewed selected text");
    expect(String(net.fetch.mock.calls[0][0])).toMatch(/^https:\/\/two\.example/);
  });
});

// A controller snapshot cannot expose originals even outside the React view.
it("owns immutable capture privately and preserves its first review when a second capture is attempted", async () => {
  const net = wire();
  const value = runtime(net.fetch);
  const controller = new SelectionReviewController({
    sessionId: "session",
    api: value.api,
    captureActivation: () => () => true,
    accepted: vi.fn(),
  });
  function View() {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    return <p>{state.phase}</p>;
  }
  render(<View />);
  await act(async () => controller.capture(capture, { delivery: "send" }));
  await waitFor(() => expect(controller.getSnapshot().phase).toBe("reviewed"));
  act(() =>
    controller.capture({ ...capture, selectedText: "other selection" }, { delivery: "queue" }),
  );
  expect(net.previews).toHaveLength(1);
  expect(JSON.stringify(controller.getSnapshot())).not.toContain("SECRET_VALUE");
  expect(JSON.stringify(controller)).not.toContain("SECRET_VALUE");
  expect(controller.getSnapshot().preview?.text).toBe(canonical);
  controller.dispose();
});
