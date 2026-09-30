import { Effect, Exit, Layer, Scope } from "effect";

import { SessionObservation, observeSession, type ObservationPorts } from "./streamReconciliation";

/** Acquire one activation synchronously so StrictMode cleanup precedes reacquisition. */
export function openSessionObservation(ports: ObservationPorts): () => void {
  const scope = Effect.runSync(Scope.make());
  const lease = (() => {
    try {
      return Effect.runSync(
        observeSession.pipe(
          Effect.provide(Layer.succeed(SessionObservation, ports)),
          Scope.extend(scope),
        ),
      );
    } catch (error) {
      ports.detach();
      Effect.runSync(Scope.close(scope, Exit.void));
      throw error;
    }
  })();
  return () => {
    lease.close();
    Effect.runSync(Scope.close(scope, Exit.void));
  };
}
