/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NativePresentationRoot } from "@/app/runtime/NativePresentationRoot";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";

// Controller lifetime/transport tests; the production route has separate coverage.
vi.mock("@/App", () => ({ default: () => null }));
const instances: NativeRuntime[] = [];
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  for (const runtime of instances.splice(0)) runtime.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function runtime(name: string, fetch: typeof globalThis.fetch) {
  const instance = createNativeRuntime({
    scope: {
      owner: name,
      profile: "standalone",
      organization: name,
      host: name,
      incarnation: name,
      endpoint: `/${name}`,
      release: "test",
    },
    client: createNacClient({ endpoint: `/${name}`, fetch }),
  });
  instances.push(instance);
  return instance;
}
const router = (children: React.ReactNode) => children;

it("retries the same bounded ACK after a transport failure", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new Error("disconnected"))
    .mockResolvedValue(new Response(null, { status: 204 }));
  const instance = runtime("retry", fetch);
  const owner = instance.stores.attentionStore;
  render(<NativePresentationRoot runtime={instance} router={router} />);
  await act(async () => {
    owner.clearAttention("opened", 1);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(owner.attentionStore.getState().acknowledgements).toEqual({ opened: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetch.mock.calls) {
    expect(url).toBe("/retry/sessions/opened/heartbeats/attention");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ through_sequence: 1 });
  }
  expect(owner.attentionStore.getState().acknowledgements).toEqual({});
});

it("keeps a newer watermark pending when the older request completes", async () => {
  const older = Promise.withResolvers<Response>();
  const newer = Promise.withResolvers<Response>();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  const instance = runtime("ordered", fetch);
  const owner = instance.stores.attentionStore;
  render(<NativePresentationRoot runtime={instance} router={router} />);
  act(() => owner.clearAttention("opened", 1));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  act(() => owner.clearAttention("opened", 3));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  await act(async () => older.resolve(new Response(null, { status: 204 })));
  expect(owner.attentionStore.getState().acknowledgements).toEqual({ opened: 3 });
  await act(async () => newer.resolve(new Response(null, { status: 204 })));
  expect(owner.attentionStore.getState().acknowledgements).toEqual({});
});

it("discards an old runtime's late ACK completion after replacement", async () => {
  const oldReply = Promise.withResolvers<Response>();
  const nextReply = Promise.withResolvers<Response>();
  const oldFetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(oldReply.promise);
  const nextFetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(nextReply.promise);
  const old = runtime("old", oldFetch);
  const next = runtime("next", nextFetch);
  const view = render(<NativePresentationRoot runtime={old} router={router} />);
  act(() => old.stores.attentionStore.clearAttention("opened", 1));
  await waitFor(() => expect(oldFetch).toHaveBeenCalledTimes(1));
  view.rerender(<NativePresentationRoot runtime={next} router={router} />);
  act(() => next.stores.attentionStore.clearAttention("opened", 3));
  await waitFor(() => expect(nextFetch).toHaveBeenCalledTimes(1));
  await act(async () => oldReply.resolve(new Response(null, { status: 204 })));
  expect(old.isClosed()).toBe(true);
  expect(next.stores.attentionStore.attentionStore.getState().acknowledgements).toEqual({
    opened: 3,
  });
  await act(async () => nextReply.resolve(new Response(null, { status: 204 })));
  expect(next.stores.attentionStore.attentionStore.getState().acknowledgements).toEqual({});
});
