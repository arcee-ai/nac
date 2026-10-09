import { afterEach, describe, expect, it, vi } from "vitest";
import { createNacClient, ApiError } from "../services/nacClient";
import { queryKeys } from "../services/queries/keys";
import type { SessionEventEnvelope } from "../types/api";
import { createNativeRuntime, type NativeRuntimeScope } from "./nativeRuntime";

const scope: NativeRuntimeScope = {
  owner: "owner",
  profile: "profile",
  organization: "org",
  host: "host",
  incarnation: "incarnation",
  endpoint: "/runtime",
  release: "release",
};
const opened: ReturnType<typeof createNativeRuntime>[] = [];
function runtime(fetch: typeof globalThis.fetch = vi.fn(), binding = scope) {
  const instance = createNativeRuntime({
    scope: binding,
    client: createNacClient({ endpoint: binding.endpoint, fetch }),
  });
  opened.push(instance);
  return instance;
}
afterEach(() => {
  for (const instance of opened.splice(0)) instance.close();
  vi.useRealTimers();
});

class Stream {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, EventListenerOrEventListenerObject>();
  addEventListener(name: string, listener: EventListenerOrEventListenerObject) {
    this.listeners.set(name, listener);
  }
  // Deliberately delivers after close, exercising the shared client's callback fence.
  emit(name: string, value: unknown) {
    const event = new MessageEvent(name, { data: JSON.stringify(value) });
    const listener = this.listeners.get(name);
    if (typeof listener === "function") listener(event);
    else listener?.handleEvent(event);
  }
  close() {
    this.closed = true;
  }
}

function envelope(sequence_id: number): SessionEventEnvelope {
  return { epoch_id: "epoch", sequence_id, event: { type: "run_cancelled" } };
}

describe("native runtime lifetime", () => {
  it("isolates equal IDs and endpoints, including live output and browser presentation", () => {
    const left = runtime();
    const right = runtime();
    left.queryClient.setQueryData(queryKeys.sessionSnapshot("same"), { source: "left" });
    right.queryClient.setQueryData(queryKeys.sessionSnapshot("same"), { source: "right" });
    const hashes = [left, right].map((r) => r.queryClient.getQueryCache().getAll()[0].queryHash);
    expect(hashes[0]).not.toBe(hashes[1]);
    left.stores.runtimeStore.resetRuntime("same");
    left.stores.runtimeStore.applyAssistantDelta({ text: "private-left" });
    left.stores.chatTabsStore.dismissChatTab("same");
    left.stores.sessionLayoutStore.selectFile("private-left.txt");
    left.stores.composerStore.sendPrompt("private-left-prompt");
    expect(right.stores.runtimeStore.getRuntimeState().streamText).toBe("");
    expect(right.stores.chatTabsStore.chatTabsStore.getState().dismissed.size).toBe(0);
    expect(right.stores.sessionLayoutStore.sessionLayoutStore.getState().selectedFile).toBeNull();
    left.close();
    expect(left.stores.runtimeStore.getRuntimeState().streamText).toBe("");
    expect(left.stores.chatTabsStore.chatTabsStore.getState().dismissed.size).toBe(0);
    expect(left.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(right.queryClient.getQueryData(queryKeys.sessionSnapshot("same"))).toEqual({
      source: "right",
    });
  });

  it.each([
    "owner",
    "profile",
    "organization",
    "host",
    "incarnation",
    "endpoint",
    "release",
  ] as const)("fences replacement of %s", (field) => {
    const binding = { ...scope };
    const original = runtime(vi.fn(), binding);
    binding[field] = "replacement";
    expect(original.scope[field]).toBe(scope[field]);
    expect(Object.isFrozen(original.scope)).toBe(true);
    original.close();
    const replacement = runtime(vi.fn(), {
      ...scope,
      [field]: field === "endpoint" ? "/next" : "next",
    });
    expect(replacement.id).not.toBe(original.id);
    expect(replacement.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("aborts pending reads immediately and discards a transport's late snapshot", async () => {
    const pending = Promise.withResolvers<Response>();
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
      signal = init?.signal;
      return pending.promise;
    });
    const instance = runtime(fetch);
    const read = instance.queryClient.fetchQuery({
      queryKey: queryKeys.sessionSnapshot("same"),
      queryFn: () => instance.api.getSession("same"),
    });
    const rejected = expect(read).rejects.toBeDefined();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    instance.close();
    expect(signal?.aborted).toBe(true);
    await rejected;
    pending.resolve(Response.json({ metadata: { session_id: "same" } }));
    await Promise.resolve();
    expect(instance.queryClient.getQueryData(queryKeys.sessionSnapshot("same"))).toBeUndefined();
    await expect(instance.api.listProjects()).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("never dispatches after an asynchronous authorization wait is released late", async () => {
    const headers = Promise.withResolvers<HeadersInit>();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const instance = createNativeRuntime({
      scope,
      client: createNacClient({ endpoint: scope.endpoint, headers: () => headers.promise, fetch }),
    });
    opened.push(instance);
    const request = instance.api.createSession({ cwd: "/repo", behavior: "direct" });
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    await Promise.resolve();
    instance.close();
    await rejected;
    headers.resolve({ Authorization: "caller-auth" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps lost or aborted billable responses uncertain without a second dispatch", async () => {
    const pending = Promise.withResolvers<Response>();
    const fetch = vi.fn<typeof globalThis.fetch>(() => pending.promise);
    const instance = runtime(fetch);
    const submission = instance.api.submitRun("same", "one prompt");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    instance.close();
    expect(await submission).toMatchObject({ status: "uncertain" });
    pending.resolve(Response.json({ run_id: "accepted" }));
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
    expect(await instance.api.submitRun("same", "closed")).toMatchObject({ status: "not-sent" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("preserves known HTTP errors from a separately installed client copy", async () => {
    class InstalledApiError extends Error {
      override name = "ApiError";
      status = 409;
      method = "POST";
      path = "/projects";
      requestId = "caller-request";
    }
    const foreign = new InstalledApiError("native conflict (HTTP 409)");
    expect(foreign).not.toBeInstanceOf(ApiError);
    const source = createNacClient({ endpoint: scope.endpoint });
    source.transport.request = vi.fn().mockRejectedValue(foreign);
    source.transport.admit = vi.fn().mockRejectedValue(foreign);
    const instance = createNativeRuntime({ scope, client: source });
    opened.push(instance);
    const failure: unknown = await instance.api
      .createProject({ cwd: "/repo" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      message: foreign.message,
      status: 409,
      requestId: "caller-request",
      cause: foreign,
    });
    await expect(instance.api.submitRun("same", "prompt")).rejects.toBeInstanceOf(ApiError);
    expect(source.transport.request).toHaveBeenCalledOnce();
    expect(source.transport.admit).toHaveBeenCalledOnce();
  });

  it("preserves injected transport routing for HTTP, initial streams and cursor reconnects", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json([]));
    const client = createNacClient({ endpoint: scope.endpoint, fetch });
    client.transport.url = vi.fn((path: string) => `/caller${scope.endpoint}${path}`);
    const streams: Stream[] = [];
    const urls: string[] = [];
    const instance = createNativeRuntime({
      scope,
      client,
      eventSource: (url) => {
        const stream = new Stream();
        streams.push(stream);
        urls.push(url);
        return stream as unknown as EventSource;
      },
    });
    opened.push(instance);
    await instance.api.listProjects();
    expect(fetch).toHaveBeenCalledWith("/caller/runtime/projects", expect.anything());
    instance.events("same", { onEnvelope: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual(["/caller/runtime/sessions/same/events/stream"]);
    streams[0].onopen?.();
    streams[0].emit("session_event", envelope(1));
    await vi.advanceTimersByTimeAsync(0);
    streams[0].onerror?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(urls[1]).toBe(
      "/caller/runtime/sessions/same/events/stream?after_epoch_id=epoch&after_sequence_id=1",
    );
    instance.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(streams.every((stream) => stream.closed)).toBe(true);
    expect(urls).toHaveLength(2);
  });

  it("refreshes caller authorization on reconnect, preserves cursor and closes every stream", async () => {
    vi.useFakeTimers();
    const streams: Stream[] = [];
    const urls: string[] = [];
    const authorizations: string[] = [];
    let generation = 0;
    const instance = createNativeRuntime({
      scope,
      client: createNacClient({
        endpoint: scope.endpoint,
        headers: () => ({ Authorization: `auth-${++generation}` }),
      }),
      eventSource: (url, _init, context) => {
        const stream = new Stream();
        streams.push(stream);
        urls.push(url);
        authorizations.push(context.headers.authorization);
        return stream as unknown as EventSource;
      },
    });
    opened.push(instance);
    const observed: number[] = [];
    instance.events("same", {
      onEnvelope: (event) => {
        observed.push(event.sequence_id);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    streams[0].onopen?.();
    streams[0].emit("session_event", envelope(1));
    await vi.advanceTimersByTimeAsync(0);
    streams[0].onerror?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(authorizations).toEqual(["auth-1", "auth-2"]);
    streams[1].onopen?.();
    expect(urls[1]).toContain("after_epoch_id=epoch&after_sequence_id=1");
    streams[0].emit("session_event", envelope(2));
    streams[1].emit("session_event", envelope(1));
    streams[1].emit("session_event", envelope(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(299_500);
    expect(streams[1].closed).toBe(true);
    expect(authorizations).toHaveLength(3);
    instance.close();
    streams[2].emit("session_event", envelope(3));
    await vi.advanceTimersByTimeAsync(600_000);
    expect(observed).toEqual([1, 2]);
    expect(streams.every((stream) => stream.closed)).toBe(true);
    expect(authorizations).toHaveLength(3);
  });
});

it("copies immutable asset URLs without sharing caller-owned mutable options", () => {
  const assets = { mathjaxFontUrl: "/caller/packed/fonts" };
  const instance = createNativeRuntime({
    scope,
    client: createNacClient({ endpoint: scope.endpoint, fetch: vi.fn() }),
    assets,
  });
  opened.push(instance);
  assets.mathjaxFontUrl = "/different/fonts";
  expect(instance.assets?.mathjaxFontUrl).toBe("/caller/packed/fonts");
  expect(Object.isFrozen(instance.assets)).toBe(true);
});
