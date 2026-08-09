import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("queued run API", () => {
  it("sends the caller's stable client message id and reads tagged dispositions", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        disposition: "queued",
        queued_message: { queued_run_id: "queued-1", version: 0 },
      }, 202),
    );
    vi.stubGlobal("fetch", fetch);

    const response = await api.submitRun("session/1", "next", "client-stable");
    expect(response.disposition).toBe("queued");
    expect(fetch).toHaveBeenCalledWith(
      "/sessions/session%2F1/runs",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          prompt: "next",
          client_message_id: "client-stable",
        }),
      }),
    );
  });

  it("uses version CAS for edit and delete", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ queued_run_id: "queue/1", version: 8 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await api.editQueuedRun("session-1", "queue/1", {
      prompt: "changed",
      expected_version: 7,
    });
    await api.deleteQueuedRun("session-1", "queue/1", 8);

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/sessions/session-1/queued-runs/queue%2F1",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ prompt: "changed", expected_version: 7 }),
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/sessions/session-1/queued-runs/queue%2F1?expected_version=8",
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });
});

describe("exact thread dispatch API", () => {
  it("sends every identity field to encoded cancellation and steering routes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          outcome: "requested",
          origin_run_id: "old-run",
          thread_name: "impl/reused",
          dispatch_id: "dispatch/7",
          originating_tool_call_id: "call-7",
          terminal: false,
          terminal_status: null,
        }, 202),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          steering_id: 31,
          origin_run_id: "old-run",
          thread_name: "impl/reused",
          dispatch_id: "dispatch/7",
          originating_tool_call_id: "call-7",
          status: "queued",
          instruction_preview: "check this",
        }, 202),
      );
    vi.stubGlobal("fetch", fetch);

    await api.cancelThreadDispatch("session/1", "dispatch/7", {
      origin_run_id: "old-run",
      thread_name: "impl/reused",
      originating_tool_call_id: "call-7",
      wait_ms: 250,
    });
    await api.steerThreadDispatch("session/1", "dispatch/7", {
      origin_run_id: "old-run",
      thread_name: "impl/reused",
      originating_tool_call_id: "call-7",
      instruction: "check this",
    });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/sessions/session%2F1/thread-dispatches/dispatch%2F7/cancel",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        origin_run_id: "old-run",
        thread_name: "impl/reused",
        originating_tool_call_id: "call-7",
        wait_ms: 250,
      }),
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/sessions/session%2F1/thread-dispatches/dispatch%2F7/steering",
    );
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({
        origin_run_id: "old-run",
        thread_name: "impl/reused",
        originating_tool_call_id: "call-7",
        instruction: "check this",
      }),
    });
  });

  it("accepts an idempotent 200 terminal cancellation response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      outcome: "already_terminal",
      origin_run_id: "run-1",
      thread_name: "worker",
      dispatch_id: "dispatch-1",
      originating_tool_call_id: "call-1",
      terminal: true,
      terminal_status: "cancelled",
    }, 200)));
    const response = await api.cancelThreadDispatch("session", "dispatch-1", {
      origin_run_id: "run-1",
      thread_name: "worker",
      originating_tool_call_id: "call-1",
      wait_ms: 250,
    });
    expect(response).toMatchObject({
      outcome: "already_terminal",
      terminal: true,
      terminal_status: "cancelled",
    });
  });
});

describe("orchestrator guidance API", () => {
  it("binds guidance to the run visible when it was submitted", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        steering_id: 12,
        status: "queued",
        instruction_preview: "change direction",
      }, 202),
    );
    vi.stubGlobal("fetch", fetch);

    await api.steerOrchestrator("session-1", "change direction", "run-7");

    expect(fetch).toHaveBeenCalledWith(
      "/sessions/session-1/steering",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          instruction: "change direction",
          expected_run_id: "run-7",
        }),
      }),
    );
  });
});
