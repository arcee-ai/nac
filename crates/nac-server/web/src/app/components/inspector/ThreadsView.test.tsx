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

function renderThreads(value = snapshot()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ThreadsView snapshot={value} selected={null} onSelect={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

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
