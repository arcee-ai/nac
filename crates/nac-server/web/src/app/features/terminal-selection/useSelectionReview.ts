import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { queryKeys } from "@/app/services/queries/keys";
import { SelectionReviewController } from "./reviewController";

/** Origin-scoped invalidation receives no original draft or request variables. */
export function useSelectionReview(sessionId: string) {
  const runtime = useNativeRuntime();
  const queryClient = useQueryClient();
  const controller = useMemo(() => {
    const reconcileOrigin = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionRoot(sessionId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsAll });
    };
    return new SelectionReviewController({
      sessionId,
      api: runtime.api,
      captureActivation: () => runtime.stores.runtimeStore.captureRuntimeActivation(sessionId),
      accepted: reconcileOrigin,
      unconfirmed: reconcileOrigin,
    });
  }, [sessionId, runtime, queryClient]);
  useEffect(() => controller.retain(), [controller]);
  useEffect(
    () => runtime.stores.runtimeStore.runtimeStore.subscribe(controller.checkActivation),
    [runtime, controller],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return { controller, state };
}
