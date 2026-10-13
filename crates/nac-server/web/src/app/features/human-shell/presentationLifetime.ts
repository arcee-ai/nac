import { Effect, Exit, Scope } from "effect";
import { useEffect, useRef } from "react";

/** View disposal fences local callbacks; it never interrupts durable command settlement. */
export function useShellPresentation(binding: object, sessionId: string) {
  const activation = useRef<{ current: () => boolean } | null>(null);
  useEffect(() => {
    const scope = Effect.runSync(Scope.make());
    let active = true;
    Effect.runSync(
      Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          active = false;
        }),
      ),
    );
    activation.current = { current: () => active };
    return () => Effect.runSync(Scope.close(scope, Exit.void));
  }, [binding, sessionId]);
  return activation;
}
