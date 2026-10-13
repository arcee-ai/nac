import { useMemo, useRef, useState } from "react";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import {
  useCloseUserTerminal,
  useOpenUserTerminal,
  useUserTerminalStatus,
  useUserTerminals,
} from "./queries";
import { useTerminalController } from "./useTerminalController";

export interface TerminalSelectionCapture {
  readonly sessionId: string;
  readonly terminalId: string;
  readonly selectedText: string;
  readonly capturedAtMs: string;
  readonly sourceAlive: boolean;
}
interface TerminalPaneProps {
  sessionId: string;
  onReviewSelection?: (capture: Readonly<TerminalSelectionCapture>) => void;
}

export function TerminalPane(props: TerminalPaneProps) {
  const { api } = useNativeRuntime();
  // A replaced consumer binding discards selection, handles and pending UI work.
  const binding = useMemo(() => ({ api, id: crypto.randomUUID() }), [api]);
  return <TerminalPaneOwner key={`${binding.id}:${props.sessionId}`} {...props} />;
}

function TerminalPaneOwner({ sessionId, onReviewSelection }: TerminalPaneProps) {
  const list = useUserTerminals(sessionId);
  const open = useOpenUserTerminal(sessionId);
  const [selected, setSelected] = useState<string | null>(null);
  const launchId = useRef<string | null>(null);
  const terminals = list.data?.terminals ?? [];
  const id = selected ?? terminals[0]?.terminal_id;
  const launch = () => {
    launchId.current ??= crypto.randomUUID();
    open.mutate(launchId.current, {
      onSuccess: (result) => {
        setSelected(result.terminal_id);
        launchId.current = null;
      },
    });
  };
  return (
    <section aria-label="Session terminal" className="flex flex-col flex-1 min-h-0 gap-2 p-3">
      <div className="flex items-center flex-wrap gap-2">
        <label className="sr-only" htmlFor={`terminal-${sessionId}`}>
          Shell
        </label>
        <select
          id={`terminal-${sessionId}`}
          aria-label="Shell"
          value={id ?? ""}
          onChange={(event) => {
            setSelected(event.target.value);
          }}
          className="min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1 text-sm"
        >
          {!id ? <option value="">No shell</option> : null}
          {id && !terminals.some((item) => item.terminal_id === id) ? (
            <option value={id}>Selected shell unavailable</option>
          ) : null}
          {terminals.map((item, index) => (
            <option key={item.terminal_id} value={item.terminal_id}>
              Shell {index + 1}
              {item.alive ? "" : " (exited)"}
            </option>
          ))}
        </select>
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Secondary}
          disabled={open.isPending}
          onClick={launch}
        >
          {open.isPending
            ? "Opening shell…"
            : open.isError
              ? "Retry opening same shell"
              : "New shell"}
        </Button>
      </div>
      <p className="text-sm text-basic-secondary">
        This shell uses the agent’s execution environment and can change the same files.
      </p>
      {list.isError ? (
        <p role="alert">
          Shell list unavailable.{" "}
          <Button
            size={ButtonSize.Small}
            type="button"
            onClick={() => {
              void list.refetch();
            }}
          >
            Refresh
          </Button>
        </p>
      ) : null}
      {open.isError ? (
        <p role="alert">
          {open.error.message} Opening was not confirmed; retry uses the same launch identity.
        </p>
      ) : null}
      {id ? (
        <TerminalDisplay
          key={id}
          sessionId={sessionId}
          terminalId={id}
          onReviewSelection={onReviewSelection}
        />
      ) : (
        <p role="status">
          {list.isPending
            ? "Loading shells…"
            : "Open a shell to start typing. Terminal output stays separate from the conversation."}
        </p>
      )}
    </section>
  );
}

function TerminalDisplay({
  sessionId,
  terminalId,
  onReviewSelection,
}: TerminalPaneProps & { terminalId: string }) {
  const status = useUserTerminalStatus(sessionId, terminalId);
  const close = useCloseUserTerminal(sessionId, terminalId);
  const element = useRef<HTMLDivElement>(null);
  const controller = useTerminalController(sessionId, terminalId, element);
  const review = () => {
    const text = controller.selection();
    if (!text || !onReviewSelection) return;
    onReviewSelection(
      Object.freeze({
        sessionId,
        terminalId,
        selectedText: text,
        capturedAtMs: String(Date.now()),
        sourceAlive: status.data?.alive ?? false,
      }),
    );
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span role="status">
          {controller.phase}
          {status.data && !status.data.alive
            ? ` · Exited${status.data.exit_code == null ? "" : ` (${status.data.exit_code})`}`
            : ""}
        </span>
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Ghost}
          onClick={controller.focus}
        >
          Focus terminal
        </Button>
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Ghost}
          disabled={controller.phase === "Connecting"}
          onClick={controller.reconnect}
        >
          Reconnect
        </Button>
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Ghost}
          disabled={!status.data?.alive || close.isPending}
          onClick={() => close.mutate()}
        >
          {close.isPending ? "Closing…" : "Close shell"}
        </Button>
        {onReviewSelection ? (
          <Button
            size={ButtonSize.Small}
            type="button"
            variant={ButtonVariant.Ghost}
            onClick={review}
          >
            Review selected text
          </Button>
        ) : null}
      </div>
      {controller.notice ? <p role="alert">{controller.notice}</p> : null}
      {controller.inputFailure ? (
        <Button
          size={ButtonSize.Small}
          type="button"
          variant={ButtonVariant.Secondary}
          onClick={controller.acknowledgeInput}
        >
          Acknowledge failure and enable fresh input
        </Button>
      ) : null}
      {close.isError ? (
        <p role="alert">{close.error.message} Shell closure was not confirmed; check its status.</p>
      ) : null}
      {status.isError ? (
        <p role="alert">Shell status unavailable; reconnect to refresh observation.</p>
      ) : null}
      {status.data?.output_error ? <p role="alert">{status.data.output_error}</p> : null}
      <div
        ref={element}
        role="region"
        aria-label="Interactive terminal"
        className="flex-1 min-h-32 overflow-hidden"
        style={{ background: "#151719" }}
      />
    </>
  );
}
