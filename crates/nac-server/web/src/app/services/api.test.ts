import { afterEach, expect, it, vi } from "vitest";

import { api, ApiError } from "@/app/services/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown, contentType = "application/json") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

it("uses the exact empty-body and idempotency contract for a managed upgrade", async () => {
  const fetch = vi.fn().mockResolvedValue(
    jsonResponse(202, {
      operation_id: "operation-1",
      managed_host_id: "host-1",
      kind: "upgrade",
      state: "preparing",
    }),
  );
  vi.stubGlobal("fetch", fetch);

  await api.startManagedUpgrade("browser-request-0001");

  expect(fetch).toHaveBeenCalledExactlyOnceWith("/__managed/control/v0/upgrade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "browser-request-0001",
    },
    body: "{}",
    signal: undefined,
  });
});

it("targets the exact active run when settling a managed upgrade blocker", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", fetch);

  await api.cancelActiveRun("session/one", "run two");

  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "/sessions/session%2Fone/cancel-active-run?run_id=run%20two",
    { method: "POST", headers: {}, signal: undefined },
  );
});

it.each([
  ["GET", 401, "Authentication failed"],
  ["POST", 403, "Request denied"],
] as const)(
  "surfaces safe managed-control %s authorization failures",
  async (method, status, title) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(status, { type: "about:blank", title, status }, "application/problem+json"),
        ),
    );

    const request =
      method === "GET" ? api.getManagedUpgrade() : api.startManagedUpgrade("browser-request-0001");
    await expect(request).rejects.toMatchObject({
      name: "ApiError",
      status,
      method,
      message: `${title} (HTTP ${status})`,
    } satisfies Partial<ApiError>);
  },
);
