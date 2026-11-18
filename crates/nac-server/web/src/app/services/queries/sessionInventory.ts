import { useCallback, useLayoutEffect, useRef } from "react";
import { isCancelledError, useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "./keys";

/** A deliberate, fresh passive inventory check, independently cancellable from observers. */
export function useFreshSessionInventory(binding: object) {
  const { api } = useNativeRuntime();
  const client = useQueryClient();
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [binding],
  );
  return useCallback(async () => {
    const controller = new AbortController();
    pending.current = controller;
    const key = queryKeys.sessions(false);
    const version = client.getQueryState(key)?.dataUpdateCount;
    try {
      const entries = await api.listSessions({}, controller.signal);
      if (controller.signal.aborted) throw new Error("Session inventory verification cancelled");
      // A shared fetch started before this check must not publish older data
      // afterwards. Do not revert cache mutations that happened independently.
      await client.cancelQueries({ queryKey: key, exact: true }, { revert: false });
      const state = client.getQueryState(key);
      // Cancellation without revert preserves concurrent data, but TanStack marks
      // the query as errored. Restore that same data and timestamp to success;
      // do not treat this bookkeeping write as fresh verification.
      if (state && isCancelledError(state.error) && state.data !== undefined) {
        client.setQueryData(key, state.data, { updatedAt: state.dataUpdatedAt });
      }
      if (
        controller.signal.aborted ||
        state?.dataUpdateCount !== version ||
        state?.fetchStatus === "fetching"
      ) {
        throw new Error("Session inventory changed during verification");
      }
      client.setQueryData(key, entries);
      return entries;
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [api, client]);
}
