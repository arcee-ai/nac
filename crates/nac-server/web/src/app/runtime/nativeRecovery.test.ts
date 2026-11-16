/** @vitest-environment jsdom */
import { createElement, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNacClient, UncertainCommandAdmissionError } from "../services/nacClient";
import { UserTerminalInputPump } from "../../../packages/nac-client/src/userTerminalInputPump";
import { useSetupLifetime } from "../features/setup/lifetime";
import type { SessionSnapshotResponse, ShellCommandSnapshot } from "../types/api";
import { NativePresentationRoot } from "./NativePresentationRoot";
import {
  createNativeRuntime,
  type NativeRuntime,
  type NativeRuntimeOptions,
  type NativeRuntimeScope,
} from "./nativeRuntime";

// These exercise the existing presentation owners with explicit caller-driven
// replacement. They do not implement or qualify AppKit crash/wake recovery.
const binding: NativeRuntimeScope = {
  owner: "local-owner",
  profile: "fixture",
  organization: "local",
  host: "bundled",
  incarnation: "serving-one",
  endpoint: "/engine-one",
  release: "fixture-build",
};
const instances: NativeRuntime[] = [];
function runtime(
  fetch: typeof globalThis.fetch,
  scope = binding,
  eventSource?: NativeRuntimeOptions["eventSource"],
  requireTerminalAcknowledgement = false,
) {
  const next = createNativeRuntime({
    scope,
    client: createNacClient({ endpoint: scope.endpoint, fetch }),
    eventSource,
    requireTerminalAcknowledgement,
  });
  instances.push(next);
  return next;
}
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  for (const instance of instances.splice(0)) instance.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function SetupRead({ signal }: { signal: (value: AbortSignal) => void }) {
  const lifetime = useSetupLifetime();
  useEffect(() => {
    signal(lifetime.current!.signal);
  }, [lifetime, signal]);
  return null;
}

const command = { request_id: "one-command", command: "printf fixture", timeout_ms: 1000 };
const acceptedCommand = {
  ...command,
  operation_id: "accepted-operation",
  state: "accepted",
  accepted_at_epoch_ms: 1,
  finished_at_epoch_ms: null,
  exit_code: null,
  stdout: "",
  stderr: "",
  diagnostic: null,
  output_id: null,
  transcript_index: null,
} satisfies ShellCommandSnapshot;

function snapshot(text: string): SessionSnapshotResponse {
  return {
    metadata: {
      session_id: "session",
      behavior: "direct",
      agents_md_status: "missing",
      backend: "local",
      cwd: "/fixture",
      model: "fixture",
      sandbox_status: "fixture",
      store_path: "/fixture/store.db",
    },
    messages: [{ role: "user", content: text }],
    message_page: { start: 0, end: 1, total: 1, has_older: false },
    response_timing: {},
    sessions: [],
    thread_episodes: {},
    thread_event_boundary: { epoch_id: "epoch-one", sequence_id: 1 },
    threads: [],
    worksets: { items: [] },
    workspace: {
      changed_files: [],
      total_additions: 0,
      total_deletions: 0,
      workspace_display: "/fixture",
    },
  };
}

describe("recovery characterization at existing owner boundaries", () => {
  it("closes presentation Effect/read/stream owners before canonical readback on the same engine", async () => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
    const stream = { close: vi.fn(), addEventListener: vi.fn(), onopen: null, onerror: null };
    const first = runtime(fetch, binding, () => stream as unknown as EventSource);
    const signals: AbortSignal[] = [];
    const mounted = render(
      createElement(NativePresentationRoot, {
        runtime: first,
        router: () => createElement(SetupRead, { signal: (value) => signals.push(value) }),
      }),
    );
    // Use the production SSE owner, including disposal on runtime closure.
    first.events("session", { onEnvelope: vi.fn() });
    await vi.waitFor(() => expect(stream.addEventListener).toHaveBeenCalled());

    const pendingSnapshot = first.queryClient.fetchQuery({
      queryKey: ["snapshot", "session"],
      queryFn: () => first.api.getSession("session"),
    });
    const abandoned = expect(pendingSnapshot).rejects.toBeDefined();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await act(async () => {
      first.close();
    });
    await abandoned;
    expect(mounted.container.innerHTML).toBe("");
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    expect(stream.close).toHaveBeenCalledOnce();
    expect(first.queryClient.getQueryCache().getAll()).toHaveLength(0);

    const canonical = snapshot("server transcript");
    const readback = vi.fn<typeof globalThis.fetch>(async (url) => {
      const path = new URL(String(url), "http://fixture.invalid");
      if (path.pathname.endsWith("/events")) {
        const replay = path.searchParams.has("after_sequence_id");
        return Response.json({
          boundary: { epoch_id: "epoch-one", sequence_id: replay ? 2 : 1 },
          events: replay
            ? [{ epoch_id: "epoch-one", sequence_id: 2, event: { type: "run_cancelled" } }]
            : [],
        });
      }
      return Response.json(canonical);
    });
    const replacement = runtime(readback); // Same engine, different presentation lifetime.
    expect(replacement.scope).toEqual(first.scope);
    expect(replacement.id).not.toBe(first.id);
    const restored = await replacement.client.captureSessionSnapshot("session");
    expect(restored.snapshot).toEqual(canonical);
    expect(restored.replay).toMatchObject({ status: "complete", cursor: { sequence_id: 2 } });
    expect(restored.replay.events).toHaveLength(1);
    response.resolve(Response.json(snapshot("retired result")));
    await Promise.resolve();
    expect(first.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(readback.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "GET", "GET"]);
  });

  it("uses production one-shot readback after a successful !command response is dropped", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === "POST") throw new TypeError("committed response dropped");
      return Response.json(acceptedCommand);
    });
    const first = runtime(fetch);
    expect(await first.api.submitShellCommand("session", command)).toEqual(acceptedCommand);
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET"]);
    expect(fetch.mock.calls[1][0]).toBe("/engine-one/sessions/session/user-commands/one-command");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual(command);
  });

  it("keeps a command uncertain if its readback is retired, then reads it through the replacement", async () => {
    const readback = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (init?.method === "POST") throw new TypeError("committed response dropped");
      return readback.promise;
    });
    const first = runtime(fetch);
    const submission = first.api.submitShellCommand("session", command);
    const uncertain = expect(submission).rejects.toBeInstanceOf(UncertainCommandAdmissionError);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    first.close();
    await uncertain;
    const nextFetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(acceptedCommand));
    const next = runtime(nextFetch);
    expect(await next.api.getShellCommand("session", command.request_id)).toEqual(acceptedCommand);
    readback.resolve(Response.json(acceptedCommand));
    await Promise.resolve();
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET"]);
    expect(nextFetch.mock.calls.map(([, init]) => init?.method)).toEqual(["GET"]);
  });

  it("does not replay a prompt whose accepted response arrives after renderer retirement", async () => {
    const accepted = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => accepted.promise);
    const first = runtime(fetch);
    const submission = first.api.submitRun("session", "one prompt");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    first.close();
    expect(await submission).toMatchObject({ status: "uncertain" });
    const nextFetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(snapshot("one prompt")),
    );
    const next = runtime(nextFetch);
    await next.api.getSession("session"); // Explicit read, never a second submitRun.
    accepted.resolve(Response.json({ run_id: "accepted-run" }));
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
    expect(nextFetch.mock.calls.map(([, init]) => init?.method)).toEqual(["GET"]);
  });

  it("fences repeated engine/endpoint/wake replacements and leaves offline recovery to the caller", async () => {
    vi.useFakeTimers();
    const late: Array<ReturnType<typeof Promise.withResolvers<Response>>> = [];
    const fetches: Array<ReturnType<typeof vi.fn<typeof globalThis.fetch>>> = [];
    // These are opaque serving-runtime bindings. The separate private launch
    // identity is verified by EngineProtocol, not inferred from this scope.
    const bindings = [
      binding,
      { ...binding, incarnation: "serving-two" },
      { ...binding, incarnation: "serving-three", endpoint: "/changed-endpoint" },
      { ...binding, incarnation: "serving-three", endpoint: "/changed-endpoint" },
    ];
    for (const scope of bindings) {
      const pending = Promise.withResolvers<Response>();
      late.push(pending);
      const fetch = vi.fn<typeof globalThis.fetch>(() => pending.promise);
      fetches.push(fetch);
      const current = runtime(fetch, scope);
      const snapshot = current.api.getSession("session");
      const closed = expect(snapshot).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledOnce();
      current.close();
      current.close();
      await closed;
    }
    for (const pending of late) pending.resolve(Response.json(snapshot("stale")));
    await vi.advanceTimersByTimeAsync(60_000);
    for (const fetch of fetches) expect(fetch).toHaveBeenCalledOnce();

    const offline = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError("offline");
    });
    const current = runtime(offline, bindings.at(-1)!);
    await expect(
      current.queryClient.fetchQuery({
        queryKey: ["snapshot", "session"],
        queryFn: () => current.api.getSession("session"),
      }),
    ).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(offline).toHaveBeenCalledOnce(); // No engine restart policy exists in this owner.
    for (const retired of instances.slice(0, -1)) expect(retired.isClosed()).toBe(true);
  });

  it("discards queued terminal bytes and reads canonical control after runtime replacement", async () => {
    const first = runtime(vi.fn());
    const lease = first.terminalInputRecovery.acquire("session", "old-engine:terminal");
    const active = Promise.withResolvers<void>();
    const input = vi.fn<(bytes: Uint8Array, signal?: AbortSignal) => Promise<void>>(
      () => active.promise,
    );
    const pump = new UserTerminalInputPump({ input, acknowledgeInputUncertainty: vi.fn() });
    const sent = pump.send(Uint8Array.of(65));
    const queued = pump.send(Uint8Array.of(66));
    const discarded = expect(queued).rejects.toMatchObject({ name: "TerminalInputNotSentError" });
    expect(pump.hasActiveInput).toBe(true);
    lease.current = pump.hasActiveInput;
    pump.dispose();
    lease.release();
    await discarded;
    expect(first.terminalInputRecovery.acquire("session", "old-engine:terminal").current).toBe(
      true,
    );
    first.close();
    active.resolve();
    await sent; // Known success can still arrive after disposal; it cannot undo the write.
    expect(input).toHaveBeenCalledOnce();
    expect(Array.from(input.mock.calls[0][0])).toEqual([65]);
    expect(pump.pendingBytes).toBe(0);
    const nextFetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ controller: "human", revision: "2", in_flight: false, frozen: true }),
    );
    const next = runtime(nextFetch, binding, undefined, true);
    // Same-engine native replacement requires explicit acknowledgement even if
    // the retired renderer could not report its local uncertainty.
    expect(next.terminalInputRecovery.acquire("session", "old-engine:terminal").current).toBe(true);
    expect(await next.api.getTerminalInputControl("session", "old-engine:terminal")).toMatchObject({
      frozen: true,
    });
    expect(nextFetch.mock.calls.map(([, init]) => init?.method)).toEqual(["GET"]);
  });
});
