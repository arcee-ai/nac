import { Cause, Exit } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientRequestError } from "@/app/effect/errors";
import { appRuntime } from "@/app/effect/runtime";
import { runEffect } from "@/app/effect/run";
import { apiEffect } from "@/app/services/api";

afterEach(() => {
  vi.unstubAllGlobals();
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

    await runEffect(apiEffect.startManagedUpgrade("browser-upgrade-request-0001"));

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
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("reads facade problem titles without exposing the raw response object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Response(
            JSON.stringify({ type: "about:blank", title: "Request denied", status: 403 }),
            {
              status: 403,
              headers: { "Content-Type": "application/problem+json" },
            },
          ),
      ),
    );

    const exit = await appRuntime.runPromiseExit(apiEffect.getManagedUpgrade());
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.squash(exit.cause);
      expect(failure).toBeInstanceOf(ClientRequestError);
      expect(failure instanceof ClientRequestError ? failure.error : failure).toEqual(
        expect.objectContaining({ status: 403, message: "Request denied (HTTP 403)" }),
      );
    }

    await expect(runEffect(apiEffect.getManagedUpgrade())).rejects.toEqual(
      expect.objectContaining({ status: 403, message: "Request denied (HTTP 403)" }),
    );
  });

  it("binds terminal termination to exact encoded session and terminal paths", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);

    await runEffect(apiEffect.terminateTerminal("session:one", "shell:one"));

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/sessions/session%3Aone/terminals/shell%3Aone",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("binds run cancellation atomically to the controller's expected run id", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetch);

    await runEffect(apiEffect.cancelExactRun("session:one", "run:one"));

    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/sessions/session%3Aone/runs/run%3Aone/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
