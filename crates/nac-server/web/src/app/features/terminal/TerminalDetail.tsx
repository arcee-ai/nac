import { useRef, type ReactNode } from "react";
import { IconName } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import type { ExecutionStatus } from "../../../../packages/nac-client/src/index";
import { ExecutionLog } from "./ExecutionLog";
import { NoticeAction, TerminalFrame, TerminalNotice, type TerminalOption } from "./TerminalChrome";
import type { TerminalSelectionCapture } from "./TerminalPane";
import type { TerminalHeading } from "./terminalLabels";
import { useInputOwnership } from "./useInputOwnership";
import { useTerminalController } from "./useTerminalController";

interface ExecutionDetailProps {
  sessionId: string;
  source: ExecutionStatus;
  heading: TerminalHeading;
  menuSlot: HTMLElement | null;
  /** Opened from history: observed read-only, with every control suppressed. */
  historical?: boolean;
  /** What history knows about the output before it is replayed. */
  notice?: string;
  onReviewSelection?: (capture: Readonly<TerminalSelectionCapture>) => void;
}

/** The open execution: an agent's command reads as a log, anything else as a terminal. */
export function ExecutionDetail({
  sessionId,
  source,
  heading,
  menuSlot,
  historical = false,
  notice,
  onReviewSelection,
}: ExecutionDetailProps) {
  const notices = [
    notice ? (
      <TerminalNotice key="history" info>
        {notice}
      </TerminalNotice>
    ) : null,
    source.output_error ? (
      <TerminalNotice key="output">{source.output_error}</TerminalNotice>
    ) : null,
  ];
  return source.representation === "log" ? (
    <ExecutionLog
      sessionId={sessionId}
      source={source}
      heading={heading}
      menuSlot={menuSlot}
      notices={notices}
    />
  ) : (
    <TerminalDisplay
      sessionId={sessionId}
      source={source}
      heading={heading}
      menuSlot={menuSlot}
      historical={historical}
      notices={notices}
      onReviewSelection={!historical && source.origin === "human" ? onReviewSelection : undefined}
    />
  );
}

function TerminalDisplay({
  sessionId,
  source,
  heading,
  menuSlot,
  historical = false,
  notices,
  onReviewSelection,
}: ExecutionDetailProps & { notices: readonly ReactNode[] }) {
  const terminalId = source.id;
  const ownership = useInputOwnership(sessionId, source, historical);
  const element = useRef<HTMLDivElement>(null);
  const controller = useTerminalController(sessionId, terminalId, element, source, {
    readonly: historical,
    inputControl: ownership.state ?? null,
    inputPaused: ownership.pending,
  });
  const change = (target: "human" | "agent", acknowledge = false) => {
    void ownership
      .change({ controller: target, acknowledge })
      .then((confirmed) => {
        if (acknowledge) controller.acknowledgeInput(confirmed);
      })
      .catch(() => {});
  };
  const review = () => {
    const text = controller.selection();
    if (!text || !onReviewSelection) return;
    onReviewSelection(
      Object.freeze({
        sessionId,
        terminalId,
        selectedText: text,
        capturedAtMs: String(Date.now()),
        sourceAlive: source.alive,
      }),
    );
  };
  const state = ownership.state;
  const owned = !historical && ownership.offered;
  const options = (): TerminalOption[] => {
    const rows: TerminalOption[] = [
      {
        label: "Reconnect",
        icon: IconName.Refresh,
        disabled: controller.phase === "Connecting",
        onSelect: controller.reconnect,
      },
    ];
    if (owned && state?.controller === "agent")
      rows.push({
        label: source.origin === "human" ? "Reclaim Input" : "Take Control",
        icon: IconName.DoubleArrowsVertical,
        disabled: ownership.pending,
        onSelect: () => change("human"),
      });
    else if (owned && state?.controller === "human")
      rows.push({
        label: "Give Agent Control",
        icon: IconName.DoubleArrowsVertical,
        disabled:
          ownership.pending ||
          state.frozen ||
          controller.inputFailure ||
          controller.hasActiveInput(),
        onSelect: () => change("agent"),
      });
    if (onReviewSelection)
      rows.push({
        label: "Review Selected text",
        icon: IconName.Eye,
        onSelect: review,
      });
    return rows;
  };
  const failed = controller.phase === "Disconnected" || controller.inputFailure;
  return (
    <TerminalFrame
      heading={heading}
      menuSlot={menuSlot}
      options={options}
      notices={[
        ...notices,
        controller.notice ? (
          <TerminalNotice key="notice" info={!failed} live="alert">
            {controller.notice}
          </TerminalNotice>
        ) : null,
        owned && ((state?.controller === "human" && state.frozen) || controller.inputFailure) ? (
          <NoticeAction
            key="acknowledge"
            disabled={ownership.pending || state?.in_flight || controller.hasActiveInput()}
            onClick={() => {
              if (state) change("human", true);
              else controller.acknowledgeInput();
            }}
          >
            Acknowledge failure and enable fresh input
          </NoticeAction>
        ) : null,
        owned && ownership.unavailable ? (
          <TerminalNotice
            key="unavailable"
            live="status"
            action={
              <NoticeAction onClick={() => void ownership.refresh()}>
                Refresh input control
              </NoticeAction>
            }
          >
            Input control is unavailable.
          </TerminalNotice>
        ) : null,
        owned && ownership.error ? (
          <TerminalNotice key="ownership">
            {ownership.error.message} Input ownership was not confirmed; refresh before another
            action.
          </TerminalNotice>
        ) : null,
      ]}
    >
      {(top) => (
        <>
          <span role="status" className="sr-only">
            {controller.phase}
            {source.alive
              ? ""
              : ` · Exited${source.exit_code == null ? "" : ` (${source.exit_code})`}`}
          </span>
          {owned ? (
            <div role="group" aria-label="Terminal input ownership" className="sr-only">
              <span role="status" aria-label="Input controller">
                {ownership.loading
                  ? "Checking input control…"
                  : state
                    ? `Input: ${state.controller === "human" ? "Human" : "Agent"}${state.frozen ? " · Frozen" : ""}`
                    : "Input unavailable"}
              </span>
            </div>
          ) : null}
          {/* xterm focuses itself on a click in its grid; the inset around it should too. */}
          <div className="flex flex-col flex-1 min-h-0" onClick={controller.focus}>
            <div
              ref={element}
              role="region"
              aria-label="Interactive terminal"
              className={cn("flex-1 min-h-32 overflow-auto pl-4 pb-4", top)}
            />
          </div>
        </>
      )}
    </TerminalFrame>
  );
}
