import { Cause, Effect, Exit } from "effect";

import { ClientRequestError } from "@/app/effect/errors";
import { appRuntime, type NacTransport } from "@/app/effect/runtime";

/** Ties a caller's AbortSignal to the signal Effect aborts when the fiber is interrupted. */
export function linkSignals(
  external?: AbortSignal,
  internal?: AbortSignal,
): AbortSignal | undefined {
  if (external && internal) return AbortSignal.any([external, internal]);
  return external ?? internal;
}

/** Lifts a Promise into an Effect and keeps the rejection as a typed error. */
export function fromPromise<A>(
  evaluate: (signal: AbortSignal) => Promise<A>,
): Effect.Effect<A, ClientRequestError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new ClientRequestError({ error: cause }),
  });
}

/**
 * Runs a program on the shared page runtime.
 * The React boundary receives the original client error, not FiberFailure.
 */
export function runEffect<A, E>(effect: Effect.Effect<A, E, NacTransport>): Promise<A> {
  return appRuntime.runPromiseExit(effect).then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    const failure = Cause.squash(exit.cause);
    throw failure instanceof ClientRequestError ? failure.error : failure;
  });
}

type Committed<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Effect.Effect<infer R, unknown, unknown>
    ? (...args: A) => Promise<R>
    : never;
};

/** Runs each lazy program when a caller still wants a Promise. */
export function commitPrograms<T extends object>(programs: T): Committed<T> {
  const committed = {} as Committed<T>;
  for (const key of Object.keys(programs) as (keyof T)[]) {
    const program = programs[key] as (
      ...args: readonly unknown[]
    ) => Effect.Effect<unknown, unknown, unknown>;
    committed[key] = ((...args: readonly unknown[]) =>
      runEffect(
        program(...args) as Effect.Effect<unknown, unknown, NacTransport>,
      )) as Committed<T>[typeof key];
  }
  return committed;
}
