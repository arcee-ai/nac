import { Cause, Data, Effect, Exit, Option } from "effect";
import type { ShellCommandRequest, ShellCommandSnapshot } from "@/app/types/api";
import type { ShellIntents, ShellIntent } from "./intents";

export class HumanCommandFailure extends Data.TaggedError("HumanCommandFailure")<{
  kind: "blocked" | "rejected" | "not-sent" | "uncertain";
  cause: unknown;
}> {}

interface CommandPorts {
  readonly sessionId: string;
  readonly command: string;
  readonly intents: ShellIntents;
  readonly submit: (request: Readonly<ShellCommandRequest>) => Promise<ShellCommandSnapshot>;
  readonly lookup: (requestId: string) => Promise<ShellCommandSnapshot>;
  readonly settled: () => void;
}
/** Browser adapters classify expected transport outcomes at the edge. */
function classified(cause: unknown): HumanCommandFailure {
  return cause instanceof HumanCommandFailure
    ? cause
    : new HumanCommandFailure({ kind: "uncertain", cause });
}
function active(command: ShellCommandSnapshot) {
  return command.state === "accepted" || command.state === "started";
}

/**
 * One scoped admission claim, one submit, and origin settlement before view callbacks.
 * Unknown intent survives remount; a changed command first needs canonical readback.
 * Transport remains the only POST + same-ID GET admission owner; no automatic replay.
 */
export function submitHumanCommand(
  ports: CommandPorts,
): Effect.Effect<ShellCommandSnapshot, HumanCommandFailure> {
  const { sessionId, intents } = ports;
  const acquire = () =>
    Effect.acquireRelease(
      Effect.try({
        try: () => intents.claim(sessionId, ports.command),
        catch: (cause) => new HumanCommandFailure({ kind: "blocked", cause }),
      }),
      (intent) => Effect.sync(() => intents.uncertain(sessionId, intent)),
    );
  const settleFailure = (intent: ShellIntent, failure: HumanCommandFailure) =>
    Effect.sync(() => {
      if (failure.kind === "uncertain") intents.uncertain(sessionId, intent);
      else intents.confirmed(sessionId, intent);
      ports.settled();
    });
  return Effect.scoped(
    Effect.gen(function* () {
      let intent = yield* acquire();
      if (intent.request.command !== ports.command) {
        const previous = yield* Effect.tryPromise({
          try: () => ports.lookup(intent.request.request_id),
          catch: classified,
        }).pipe(Effect.tapError((failure) => settleFailure(intent, failure)));
        yield* Effect.sync(() => {
          intents.confirmed(sessionId, intent);
          ports.settled();
        });
        if (active(previous))
          return yield* Effect.fail(
            new HumanCommandFailure({
              kind: "blocked",
              cause: new Error(
                "The previous command is still active. Wait or explicitly cancel it before starting another.",
              ),
            }),
          );
        intent = yield* acquire();
      }
      const accepted = yield* Effect.tryPromise({
        try: () => ports.submit(intent.request),
        catch: classified,
      }).pipe(Effect.tapError((failure) => settleFailure(intent, failure)));
      yield* Effect.sync(() => {
        intents.confirmed(sessionId, intent);
        ports.settled();
      });
      return accepted;
    }),
  );
}

/** Keep expected failures usable by the composer; defects retain diagnostics. */
export async function runHumanCommand(
  workflow: Effect.Effect<ShellCommandSnapshot, HumanCommandFailure>,
) {
  const exit = await Effect.runPromiseExit(workflow);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value.cause;
  throw Cause.squash(exit.cause);
}
