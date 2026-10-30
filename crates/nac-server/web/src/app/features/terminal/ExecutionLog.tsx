import { useEffect, useRef, useState, type ReactNode } from "react";
import { Cause, Effect, Exit, Scope } from "effect";
import {
  createExecutionConnection,
  type ExecutionStatus,
} from "../../../../packages/nac-client/src/index";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import { createLogRenderer } from "./logRenderer";
import { TerminalFrame, TerminalNotice } from "./TerminalChrome";
import type { TerminalHeading } from "./terminalLabels";

export function ExecutionLog({
  sessionId,
  source,
  heading,
  menuSlot,
  notices = [],
}: {
  sessionId: string;
  source: ExecutionStatus;
  heading: TerminalHeading;
  menuSlot: HTMLElement | null;
  notices?: readonly ReactNode[];
}) {
  const { api } = useNativeRuntime();
  const host = useRef<HTMLPreElement>(null);
  const [binding] = useState(() => source);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState("Connecting");
  const [notice, setNotice] = useState("");
  const [displayTruncated, setDisplayTruncated] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const scope = Effect.runSync(Scope.make());
    const abort = new AbortController();
    const view = createLogRenderer(host.current, setDisplayTruncated);
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
    <TerminalFrame
      heading={heading}
      menuSlot={menuSlot}
      options={() => [
        {
          label: "Reconnect",
          icon: IconName.Refresh,
          onSelect: () => setAttempt((value) => value + 1),
        },
      ]}
      notices={[
        ...notices,
        notice ? (
          <TerminalNotice key="notice" info={phase !== "Disconnected"} live="alert">
            {notice}
          </TerminalNotice>
        ) : null,
        displayTruncated ? (
          <TerminalNotice key="display" info>
            Display limit reached. Showing the latest output; earlier text is hidden in this view.
          </TerminalNotice>
        ) : null,
      ]}
    >
      {(top) => (
        <>
          <span role="status" className="sr-only">
            {phase}
          </span>
          <pre
            ref={host}
            tabIndex={0}
            role="region"
            aria-label="Execution log"
            className={cn(
              "flex-1 min-h-32 overflow-auto whitespace-pre-wrap break-words px-4 pb-4 font-[family-name:IBMPlexMono] text-sm font-medium text-basic-primary -outline-offset-2 outline-[var(--color-border-focus-outline)] focus-visible:outline-2",
              top,
            )}
          />
        </>
      )}
    </TerminalFrame>
  );
}
