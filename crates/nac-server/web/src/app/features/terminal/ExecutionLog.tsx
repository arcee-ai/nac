import { useEffect, useRef, useState } from "react";
import { Cause, Effect, Exit, Scope } from "effect";
import {
  createExecutionConnection,
  type ExecutionStatus,
} from "../../../../packages/nac-client/src/index";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { createLogRenderer } from "./logRenderer";

export function ExecutionLog({
  sessionId,
  source,
}: {
  sessionId: string;
  source: ExecutionStatus;
}) {
  const { api } = useNativeRuntime();
  const host = useRef<HTMLPreElement>(null);
  const [binding] = useState(() => source);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("Connecting");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!host.current) return;
    const scope = Effect.runSync(Scope.make());
    const abort = new AbortController();
    const view = createLogRenderer(host.current);
    const connection = createExecutionConnection(api, sessionId, binding, view.renderer, {
      pageLimit: 32_768,
    });
    Effect.runSync(
      Scope.addFinalizer(
        scope,
        Effect.sync(() => {
          view.dispose();
          void connection.detach().catch(() => {});
        }),
      ),
    );
    const observation = Effect.tryPromise({
      try: async () => {
        setPhase("Connecting");
        setNotice("");
        await connection.attach(abort.signal, attempt ? "reconnect" : "attach");
        if (abort.signal.aborted) return;
        setPhase("Connected");
        await connection.run(abort.signal, (frame) => {
          if (frame.gap && !abort.signal.aborted)
            setNotice("Earlier output was discarded. The log was reset before replay.");
        });
        if (!abort.signal.aborted) {
          view.finish();
          setPhase("Output complete");
        }
      },
      catch: (cause) => cause,
    });
    void Effect.runPromiseExit(observation, { signal: abort.signal }).then((exit) => {
      if (!abort.signal.aborted && Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);
        setPhase("Disconnected");
        setNotice(error instanceof Error ? error.message : "Log observation unavailable");
      }
    });
    return () => {
      abort.abort();
      Effect.runSync(Scope.close(scope, Exit.void));
    };
  }, [api, sessionId, binding, attempt]);
  return (
    <>
      <div className="flex items-center gap-2">
        <span role="status">{phase}</span>
        <Button
          type="button"
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Reconnect
        </Button>
      </div>
      {notice ? <p role="alert">{notice}</p> : null}
      <pre
        ref={host}
        tabIndex={0}
        role="region"
        aria-label="Execution log"
        className="flex-1 min-h-32 overflow-auto whitespace-pre-wrap break-words bg-elevation-level-1 p-2 text-sm font-mono"
      />
    </>
  );
}
