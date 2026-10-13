/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createNacClient,
  UncertainCommandAdmissionError,
} from "@/app/services/nacClient";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { queryKeys } from "@/app/services/queries/keys";
import { useCancelShellCommand, useShellOutput, useSubmitShellCommand } from "./queries";

const opened: NativeRuntime[] = [];
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
  opened.push(value);
  return value;
}
function wrapper(value: NativeRuntime) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={value.queryClient}>
      <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
    </QueryClientProvider>
  );
}
function accepted(requestId: string) {
  return Response.json({
    request_id: requestId,
    operation_id: "operation",
    command: "canonical",
    state: "completed",
    timeout_ms: 30000,
    accepted_at_epoch_ms: 1,
    stdout: "retained",
    stderr: "",
    output_id: "output",
  });
}
afterEach(() => {
  cleanup();
  for (const value of opened.splice(0)) value.close();
});

describe("consumer-bound shell queries", () => {
  it("disables inherited mutation retries and retains unknown immutable intent through remount", async () => {
    const ids: string[] = [];
    const methods: string[] = [];
    let allow = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      methods.push(init!.method!);
      if (init!.method === "POST") {
        const body = JSON.parse(String(init!.body));
        ids.push(body.request_id);
        if (allow) return accepted(body.request_id);
      }
      throw new TypeError("lost ACK/readback");
    });
    const value = runtime(fetch);
    value.queryClient.setDefaultOptions({ mutations: { retry: 3, retryDelay: 0 } });
    let hook = renderHook(() => useSubmitShellCommand("same"), { wrapper: wrapper(value) });
    await act(async () => {
      await expect(hook.result.current.mutateAsync(" exact\n")).rejects.toBeInstanceOf(Error);
    });
    expect(methods).toEqual(["POST", "GET"]);
    const cachedVariables = value.queryClient
      .getMutationCache()
      .getAll()
      .map((entry) => entry.state.variables);
    expect(JSON.stringify(cachedVariables)).not.toContain(" exact");
    const retained = value.stores.composerStore.shellIntents.get("same")!;
    expect(retained.phase).toBe("uncertain");
    hook.unmount();
    hook = renderHook(() => useSubmitShellCommand("same"), { wrapper: wrapper(value) });
    await act(async () => {
      await expect(hook.result.current.mutateAsync("changed")).rejects.toBeInstanceOf(Error);
    });
    expect(methods).toEqual(["POST", "GET", "GET"]);
    expect(value.stores.composerStore.shellIntents.get("same")?.request).toBe(retained.request);
    allow = true;
    await act(async () => {
      await hook.result.current.mutateAsync(" exact\n");
    });
    expect(ids).toEqual([retained.request.request_id, retained.request.request_id]);
    expect(value.stores.composerStore.shellIntents.get("same")).toBeUndefined();
  });

  it("preserves private exact intent after HTTP500 plus failed GET through remount and explicit retry", async () => {
    const bodies: unknown[] = [];
    const methods: string[] = [];
    let acceptedId: string | undefined;
    let allowReadback = false;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      methods.push(init!.method!);
      if (init!.method === "POST") {
        const body = JSON.parse(String(init!.body));
        bodies.push(body);
        acceptedId ??= body.request_id;
        if (allowReadback) return accepted(acceptedId!);
        return Response.json({ error: "commit acknowledgement unavailable" }, { status: 500 });
      }
      return Response.json({ error: "readback unavailable" }, { status: 503 });
    });
    const value = runtime(fetch);
    value.queryClient.setDefaultOptions({ mutations: { retry: 3, retryDelay: 0 } });
    let hook = renderHook(() => useSubmitShellCommand("same"), { wrapper: wrapper(value) });
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync(" private HTTP500 draft\n"),
      ).rejects.toBeInstanceOf(UncertainCommandAdmissionError);
    });
    const retained = value.stores.composerStore.shellIntents.get("same")!;
    expect(retained.phase).toBe("uncertain");
    expect(retained.request.command).toBe(" private HTTP500 draft\n");
    expect(retained.request.request_id).toBe(acceptedId);
    expect(methods).toEqual(["POST", "GET"]);
    expect(
      JSON.stringify(
        value.queryClient
          .getMutationCache()
          .getAll()
          .map((entry) => entry.state.variables),
      ),
    ).not.toContain("private HTTP500 draft");
    hook.unmount();
    hook = renderHook(() => useSubmitShellCommand("same"), { wrapper: wrapper(value) });
    allowReadback = true;
    await act(async () => {
      await hook.result.current.mutateAsync(" private HTTP500 draft\n");
    });
    expect(methods).toEqual(["POST", "GET", "POST"]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(value.stores.composerStore.shellIntents.get("same")).toBeUndefined();
  });
  it("defensively retains unknown identity if a supplied human API throws HTTP500 directly", async () => {
    const value = runtime(vi.fn());
    const error = new ApiError(500, "POST", "/user-commands", "unknown admission", "id");
    vi.spyOn(value.api, "submitShellCommand").mockRejectedValue(error);
    const hook = renderHook(() => useSubmitShellCommand("same"), { wrapper: wrapper(value) });
    await act(async () => {
      await expect(hook.result.current.mutateAsync("private draft")).rejects.toBe(error);
    });
    expect(value.stores.composerStore.shellIntents.get("same")?.phase).toBe("uncertain");
  });
  it("settles the original cache after view detach without affecting another immutable binding", async () => {
    let complete!: (response: Response) => void;
    let id!: string;
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
      id = JSON.parse(String(init!.body)).request_id;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const origin = runtime(fetch);
    const nextFetch = vi.fn<typeof globalThis.fetch>();
    const next = runtime(nextFetch, "two");
    const invalidate = vi.spyOn(origin.queryClient, "invalidateQueries");
    const nextInvalidate = vi.spyOn(next.queryClient, "invalidateQueries");
    const hook = renderHook(() => useSubmitShellCommand("same"), { wrapper: wrapper(origin) });
    let pending!: Promise<unknown>;
    act(() => {
      pending = hook.result.current.mutateAsync("private command");
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    hook.unmount();
    renderHook(() => useSubmitShellCommand("same"), { wrapper: wrapper(next) });
    await act(async () => {
      complete(accepted(id));
      await pending;
    });
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.sessionRoot("same") });
    // Session-root and summary invalidations are both origin-bound.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.sessionsAll });
    expect(nextInvalidate).not.toHaveBeenCalled();
    expect(nextFetch).not.toHaveBeenCalled();
    expect(next.stores.composerStore.shellIntents.get("same")).toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe("https://one.example/nac/sessions/same/user-commands");
    expect(fetch.mock.calls[0][1]?.credentials).toBe("omit");
  });

  it("aborts only the view-owned output read and drops its late result", async () => {
    let signal!: AbortSignal;
    let complete!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>((_url, init) => {
      signal = init!.signal as AbortSignal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    });
    const value = runtime(fetch);
    const read = renderHook(() => useShellOutput("same", "id", 0, true), {
      wrapper: wrapper(value),
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    read.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () =>
      complete(
        Response.json({ content: "late", eof: true, next_offset: 4, offset: 0, overflowed: false }),
      ),
    );
    expect(
      value.queryClient.getQueryData(["session", "same", "human-shell-output", "id", 0]),
    ).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses bound output paging/cancellation and TanStack read disposal", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).includes("/output?"))
        return Response.json({
          content: "retained",
          offset: 12,
          next_offset: 24,
          eof: false,
          overflowed: true,
        });
      return accepted("id");
    });
    const value = runtime(fetch, "two");
    const output = renderHook(() => useShellOutput("same", "id", 12, true), {
      wrapper: wrapper(value),
    });
    await waitFor(() => expect(output.result.current.data?.content).toBe("retained"));
    expect(fetch.mock.calls[0][0]).toBe(
      "https://two.example/nac/sessions/same/user-commands/id/output?offset=12",
    );
    const cancel = renderHook(() => useCancelShellCommand("same"), { wrapper: wrapper(value) });
    await act(async () => {
      await cancel.result.current.mutateAsync("id");
    });
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/user-commands/id/cancel"))).toBe(
      true,
    );
  });
});
