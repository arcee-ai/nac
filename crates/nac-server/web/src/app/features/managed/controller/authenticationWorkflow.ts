import { Cause, Data, Effect, Exit, Option } from "effect";

/** Provider account commands own settlement; their presentation may detach. */
class AuthenticationFailure extends Data.TaggedError("AuthenticationFailure")<{ cause: unknown }> {}

export function authenticationCommand<T>(ports: {
  command: () => Promise<T>;
  reconcile?: () => Promise<unknown>;
}) {
  return Effect.tryPromise({
    try: ports.command,
    catch: (cause) => new AuthenticationFailure({ cause }),
  }).pipe(Effect.ensuring(Effect.promise(() => ports.reconcile?.() ?? Promise.resolve())));
}

export async function runAuthentication<T>(
  workflow: Effect.Effect<T, AuthenticationFailure>,
): Promise<T> {
  const result = await Effect.runPromiseExit(workflow);
  if (Exit.isSuccess(result)) return result.value;
  const failure = Cause.failureOption(result.cause);
  if (Option.isSome(failure)) throw failure.value.cause;
  throw Cause.squash(result.cause);
}
