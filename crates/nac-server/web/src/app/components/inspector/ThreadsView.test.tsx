import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadsView } from "@/app/components/inspector/ThreadsView";
import { ToastProvider } from "@/app/providers/ToastProvider";
import type { SessionSnapshotResponse } from "@/app/types/api";

function snapshot(): SessionSnapshotResponse {
  return {
    metadata: { session_id: "session-1" },
    messages: [],
    respond_live: { enabled: false, version: 3 },
    active_run: { run_id: "run-1" },
    active_threads: ["worker"],
    active_thread_dispatches: [],
    threads: [],
    thread_episodes: {},
    thread_events: {},
  } as unknown as SessionSnapshotResponse;
}

function activeSnapshot(): SessionSnapshotResponse {
  const value = snapshot();
  value.active_thread_dispatches = [
    {
      run_id: "old-run",
      thread_name: "worker",
      dispatch_id: "old-dispatch",
      tool_call_id: "old-call",
      status: "running",
    },
    {
      run_id: "new-run",
      thread_name: "worker",
      dispatch_id: "replacement-dispatch",
      tool_call_id: "replacement-call",
      status: "running",
    },
  ];
  value.threads = [
    {
      name: "worker",
      session_id: "session-1",
      created_at: "",
      updated_at: "now",
      episode_count: 1,
      latest_action: null,
    },
  ];
  value.thread_steering = [];
  return value;
}

function renderThreads(
  value = snapshot(),
  selected: string | null = null,
  selectedEpisode: string | null = null,
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  client.setQueryData(["session", value.metadata.session_id], value);
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ThreadsView
          snapshot={value}
          selected={selected}
          selectedEpisode={selectedEpisode}
          onSelect={() => {}}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("exact dispatch actions", () => {
  it("cancels an old-run reused-name dispatch with exact identity and shows cancelling", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    renderThreads(activeSnapshot(), "worker", "old-dispatch");

    const cancel = screen.getByRole("button", { name: "Cancel dispatch worker" });
    fireEvent.click(cancel);
    await waitFor(() => expect(cancel).toHaveTextContent("Cancelling"));
    expect(fetch).toHaveBeenCalledWith(
      "/sessions/session-1/thread-dispatches/old-dispatch/cancel",
      expect.objectContaining({
        body: JSON.stringify({
          origin_run_id: "old-run",
          thread_name: "worker",
          originating_tool_call_id: "old-call",
          wait_ms: 250,
        }),
      }),
    );
    resolve(new Response(JSON.stringify({
      outcome: "requested",
      origin_run_id: "old-run",
      thread_name: "worker",
      dispatch_id: "old-dispatch",
      originating_tool_call_id: "old-call",
      terminal: false,
      terminal_status: null,
    }), { status: 202, headers: { "content-type": "application/json" } }));
    await waitFor(() => expect(cancel).toHaveTextContent("Cancelling"));
    expect(cancel).toBeDisabled();
  });

  it("queues steering for the selected dispatch without an active orchestrator", async () => {
    const value = activeSnapshot();
    delete value.active_run;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      steering_id: 8,
      origin_run_id: "old-run",
      thread_name: "worker",
      dispatch_id: "old-dispatch",
      originating_tool_call_id: "old-call",
      status: "queued",
      instruction_preview: "change course",
    }), { status: 202, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    renderThreads(value, "worker", "old-dispatch");

    fireEvent.change(screen.getByLabelText("Steer selected dispatch"), {
      target: { value: "change course" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send steering" }));

    await screen.findByText("Steering queued");
    expect(fetch).toHaveBeenCalledWith(
      "/sessions/session-1/thread-dispatches/old-dispatch/steering",
      expect.objectContaining({
        body: JSON.stringify({
          origin_run_id: "old-run",
          thread_name: "worker",
          originating_tool_call_id: "old-call",
          instruction: "change course",
        }),
      }),
    );
  });

  it("does not expose actions when only a reused name, not an exact dispatch, is selected", () => {
    renderThreads(activeSnapshot(), "worker", "missing-historical-key");
    expect(screen.queryByRole("button", { name: /Cancel dispatch/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Steer selected dispatch")).not.toBeInTheDocument();
  });

  it("reports a stale identity conflict instead of retargeting the replacement", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "dispatch identity mismatch" }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));
    renderThreads(activeSnapshot(), "worker", "old-dispatch");
    fireEvent.click(screen.getByRole("button", { name: "Cancel dispatch worker" }));
    await screen.findByText(/refreshed exact state:.*409/);
    expect(screen.getByRole("button", { name: "Cancel dispatch worker" })).toBeEnabled();
  });
});

describe("Respond live control", () => {
  it("stays authoritative, remains legal during a run, and sends the snapshot version", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    renderThreads();

    const control = screen.getByRole("switch", { name: "Respond live" });
    expect(control).not.toBeDisabled();
    expect(control).not.toBeChecked();
    fireEvent.click(control);

    await waitFor(() => expect(control).toBeDisabled());
    expect(control).not.toBeChecked();
    expect(fetch).toHaveBeenCalledWith("/sessions/session-1/respond-live", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ enabled: true, expected_version: 3 }),
    }));

    resolve(new Response(JSON.stringify({ enabled: true, version: 4 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await waitFor(() => expect(control).not.toBeDisabled());
  });

  it("does not drift optimistically when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "conflict" }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));
    renderThreads();
    const control = screen.getByRole("switch", { name: "Respond live" });
    fireEvent.click(control);
    await waitFor(() => expect(control).not.toBeDisabled());
    expect(control).not.toBeChecked();
  });
});
