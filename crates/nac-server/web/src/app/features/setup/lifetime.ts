import { Effect, Exit, Scope } from "effect";
import { useEffect, useRef } from "react";

/** Setup reads belong to a view; dispatched commands belong to the origin cache. */
export function openSetupLifetime() {
  const scope = Effect.runSync(Scope.make());
  const controller = new AbortController();
  let active = true;
  Effect.runSync(
    Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        active = false;
        controller.abort();
      }),
    ),
  );
  return {
    signal: controller.signal,
    current: () => active,
    close: () => Effect.runSync(Scope.close(scope, Exit.void)),
  };
}

export function useSetupLifetime(open = true) {
  const activation = useRef<ReturnType<typeof openSetupLifetime> | null>(null);
  useEffect(() => {
    const lease = openSetupLifetime();
    activation.current = lease;
    if (!open) lease.close();
    return lease.close;
  }, [open]);
  return activation;
}
