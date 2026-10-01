import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";
import type { subscribeToSessionEvents } from "@/app/services/eventStream";
import { queryKeys } from "@/app/services/queries/keys";
import { runtimeStore, resetRuntime } from "@/app/store/runtimeStore";
import type {
  ActiveRunSnapshot,
  MessagesPageResponse,
  SessionSnapshotResponse,
} from "@/app/types/api";
import { makeObservationPorts } from "./browserAdapters";
import { openSessionObservation } from "./browserRuntime";

afterEach(() => {
  resetRuntime(null);
  vi.restoreAllMocks();
});

it("binds transport and fences to the endpoint/cache and ignores released endpoint callbacks", async () => {
  const oldCache = new QueryClient();
  const nextCache = new QueryClient();
  const delayed = Promise.withResolvers<MessagesPageResponse>();
  const unsubscribeOld = vi.fn();
  const unsubscribeNext = vi.fn();
  const oldSubscribe = vi.fn(
    (..._args: Parameters<typeof subscribeToSessionEvents>) => unsubscribeOld,
  );
  const nextSubscribe = vi.fn(
    (..._args: Parameters<typeof subscribeToSessionEvents>) => unsubscribeNext,
  );
  const oldRead = vi.fn<typeof api.getMessages>().mockReturnValue(delayed.promise);
  const nextRead = vi.fn<typeof api.getMessages>();
  const first = makeObservationPorts(oldCache, "same-id", {
    readMessages: oldRead,
    subscribe: oldSubscribe,
  });
  const closeFirst = openSessionObservation(first);
  const read = first.tail(new AbortController().signal);
  closeFirst();
  const closeNext = openSessionObservation(
    makeObservationPorts(nextCache, "same-id", {
      readMessages: nextRead,
      subscribe: nextSubscribe,
    }),
  );
  // SAFETY: marker cache entry; obsolete responses must not inspect/merge its incomplete shape.
  const marker = nextCache.setQueryData(queryKeys.sessionSnapshot("same-id"), {
    messages: [],
  } as unknown as SessionSnapshotResponse);
  oldSubscribe.mock.calls[0][1].onAssistantDelta?.({ text: "obsolete text" });
  delayed.resolve({
    messages: [],
    created_at: [],
    page: { start: 0, end: 0, total: 0, has_older: false },
  });
  expect(await read).toEqual({ kind: "obsolete" });
  expect(oldRead.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(oldSubscribe).toHaveBeenCalledOnce();
  expect(nextSubscribe).toHaveBeenCalledOnce();
  expect(nextRead).not.toHaveBeenCalled();
  expect(nextCache.getQueryData(queryKeys.sessionSnapshot("same-id"))).toBe(marker);
  expect(runtimeStore.getState().streamText).toBe("");
  expect(unsubscribeOld).toHaveBeenCalledOnce();
  closeNext();
  expect(unsubscribeNext).toHaveBeenCalledOnce();
  expect(runtimeStore.getState().sessionId).toBeNull();
  oldCache.clear();
  nextCache.clear();
});

it("restores cached run ownership on reacquire and isolates the next endpoint", () => {
  const cache = new QueryClient();
  const nextCache = new QueryClient();
  const activeRun: ActiveRunSnapshot = {
    run_id: "cached-run",
    prompt_preview: "ongoing work",
    started_at_epoch_ms: 123456,
  };
  // Only the active run projection is read when observation acquires the cache.
  cache.setQueryData(queryKeys.sessionSnapshot("same-id"), {
    active_run: activeRun,
  } as SessionSnapshotResponse);
  const subscribe = vi.fn(() => vi.fn());
  const ports = () =>
    makeObservationPorts(cache, "same-id", {
      readMessages: api.getMessages,
      subscribe,
    });
  const first = openSessionObservation(ports());
  expect(runtimeStore.getState().running).toBe(true);
  expect(runtimeStore.getState().runStartedAt).toBe(activeRun.started_at_epoch_ms);
  first();
  expect(runtimeStore.getState().sessionId).toBeNull();
  const reacquired = openSessionObservation(ports());
  expect(runtimeStore.getState().running).toBe(true);
  expect(runtimeStore.getState().runStartedAt).toBe(activeRun.started_at_epoch_ms);
  reacquired();
  const next = openSessionObservation(
    makeObservationPorts(nextCache, "same-id", {
      readMessages: api.getMessages,
      subscribe,
    }),
  );
  expect(runtimeStore.getState().running).toBe(false);
  expect(runtimeStore.getState().runStartedAt).toBeNull();
  next();
  cache.clear();
  nextCache.clear();
});
