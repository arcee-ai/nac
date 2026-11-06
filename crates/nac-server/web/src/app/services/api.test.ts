import { afterEach, describe, expect, it, vi } from "vitest";

import { api, createNativeApi } from "@/app/services/api";
import { createNacClient } from "@/app/services/nacClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("keeps MCP refresh and fresh-task controls on the same captured client binding", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
  const otherFetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
  const bound = createNativeApi(createNacClient({ endpoint: "/bound", fetch }));
  createNativeApi(createNacClient({ endpoint: "/other", fetch: otherFetch }));
  const controller = new AbortController();
  const control = {
    request_id: "same-intent",
    operation: { action: "pause" as const, schedule_id: "schedule:one", expected_version: 7 },
    destination: null,
    creator_session_id: null,
  };
  const allowance = { request_id: "same-allowance", expected_revision: 3, retained_limit: 4 };

  await bound.sessionIntegrations("session:one", controller.signal);
  await bound.refreshSessionIntegrations("session:one", 2);
  await bound.freshTaskScheduleInventory("project:one", controller.signal);
  await bound.freshTaskScheduleInspection("project:one", "schedule:one", controller.signal);
  await bound.controlFreshTaskSchedule("project:one", control);
  await bound.changeFreshTaskRetainedAllowance("project:one", allowance);

  expect(otherFetch).not.toHaveBeenCalled();
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    "/bound/sessions/session%3Aone/integrations",
    "/bound/sessions/session%3Aone/integrations/refresh",
    "/bound/projects/project%3Aone/task-schedules",
    "/bound/projects/project%3Aone/task-schedules/schedule%3Aone",
    "/bound/projects/project%3Aone/task-schedules/control",
    "/bound/projects/project%3Aone/task-schedules/retained-allowance",
  ]);
  for (const index of [0, 2, 3]) {
    expect(fetch.mock.calls[index][1]).toMatchObject({
      method: "GET",
      signal: controller.signal,
    });
  }
  for (const [index, body] of [
    [1, { expected_revision: 2 }],
    [4, control],
    [5, allowance],
  ] as const) {
    expect(fetch.mock.calls[index][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(body),
    });
  }
});

describe("managed upgrade transport", () => {
  it("starts only the same-origin facade's empty latest-beta intent", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          operation_id: "operation-1",
          managed_host_id: "host-1",
          kind: "upgrade",
          state: "preparing",
        }),
        { status: 202, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await api.startManagedUpgrade("browser-upgrade-request-0001");

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/__managed/control/v0/upgrade",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "idempotency-key": "browser-upgrade-request-0001",
          "x-nac-request-id": expect.any(String),
        }),
        body: "{}",
        signal: undefined,
      }),
    );
  });

  it("reads facade problem titles without exposing the raw response object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ type: "about:blank", title: "Request denied", status: 403 }),
          {
            status: 403,
            headers: { "Content-Type": "application/problem+json" },
          },
        ),
      ),
    );

    await expect(api.getManagedUpgrade()).rejects.toEqual(
      expect.objectContaining({ status: 403, message: "Request denied (HTTP 403)" }),
    );
  });

  it("binds terminal termination to exact encoded session and terminal paths", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await api.terminateTerminal("session:one", "shell:one");

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/sessions/session%3Aone/terminals/shell%3Aone",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("binds run cancellation atomically to the controller's expected run id", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetch);

    await api.cancelExactRun("session:one", "run:one");

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/sessions/session%3Aone/runs/run%3Aone/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
