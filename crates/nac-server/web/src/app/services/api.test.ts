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
