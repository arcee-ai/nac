import { useCallback, useRef, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Loader,
  LoaderSize,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { cn } from "@/app/lib/cn";
import {
  formatClock,
  formatCostMicros,
  formatTokensCompact,
  runMetrics,
} from "@/app/lib/format";
import { useNow } from "@/app/hooks/useNow";
import { perfRender } from "@/app/lib/perfDebug";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useSubmitRun } from "@/app/services/queries";
import { pushLocalEvent, useRunning } from "@/app/store/runtimeStore";
import type {
  ManagedSessionSummary,
  SessionSnapshotResponse,
} from "@/app/types/api";

const MAX_HEIGHT_PX = 200;

interface ChatInputBoxProps {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
}

function StatBadge({
  iconName,
  value,
  className,
  title,
}: {
  iconName: IconName;
  value: string;
  className?: string;
  title: string;
}) {
  return (
    <Tooltip title={title} position={TooltipPosition.TopCenter}>
      <div className={cn("flex items-center gap-[2px] py-1", className)}>
        <Icon iconName={iconName} size={16} />
        <span className="label-micro">{value}</span>
      </div>
    </Tooltip>
  );
}

/**
 * Message field plus the run status bar that replaced the old metrics grid:
 * model, environment, cumulative token usage and the run timer.
 */
export function ChatInputBox({
  sessionId,
  snapshot,
  entry,
}: ChatInputBoxProps) {
  perfRender("ChatInputBox");
  const [value, setValue] = useState("");
  const running = useRunning();
  const toast = useToast();
  const actions = useSessionActions();
  const submitRun = useSubmitRun();
  const ref = useRef<HTMLTextAreaElement>(null);

  const metrics = runMetrics(snapshot, entry);
  const now = useNow(1000, running);
  const elapsedMs = metrics.startedAt
    ? now - metrics.startedAt
    : metrics.lastResponseMs;

  const busy = submitRun.isPending || running;
  const canSend = Boolean(value.trim()) && !busy;

  const submit = useCallback(async () => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    try {
      await submitRun.mutateAsync({ id: sessionId, prompt });
      pushLocalEvent("run", `▶ submitted: ${prompt.slice(0, 80)}`);
      setValue("");
      if (ref.current) ref.current.style.height = "auto";
    } catch (error) {
      const message = errorMessage(error);
      pushLocalEvent("error", `submit failed: ${message}`, true);
      toast.error(`Failed to send: ${message}`);
    }
  }, [value, busy, sessionId, submitRun, toast]);

  const stop = useCallback(async () => {
    const summary = entry?.summary;
    if (summary) await actions.stopRun(summary);
  }, [actions, entry]);

  return (
    <form
      className={cn(
        "flex flex-col gap-4 p-4 rounded-[8px]",
        "bg-elevation-level-1 shadow-2xl",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="relative flex items-end rounded-[4px] bg-input shadow-concave pr-[48px]">
        <textarea
          ref={ref}
          className="flex-1 min-w-0 bg-transparent resize-none border-none outline-none p-3 text-medium text-input placeholder:text-input-placeholder"
          rows={1}
          placeholder={running ? "Run in progress…" : "Send a message"}
          spellCheck={false}
          value={value}
          disabled={busy}
          style={{ minHeight: "48px", maxHeight: `${MAX_HEIGHT_PX}px` }}
          onChange={(e) => {
            setValue(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            // Shift+Enter inserts a newline; a bare Enter (or Cmd/Ctrl+Enter) sends.
            if (e.shiftKey) return;
            // Enter also commits an in-flight IME composition, so it must not send.
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            void submit();
          }}
        />
        <Button
          className="absolute bottom-0 right-0"
          size={ButtonSize.Large}
          variant={ButtonVariant.Primary}
          content={ButtonContent.Icon}
          type={running ? "button" : "submit"}
          disabled={!running && !canSend}
          aria-label={running ? "Stop run" : "Send"}
          onClick={running ? () => void stop() : undefined}
        >
          <Icon iconName={running ? IconName.Stop : IconName.Plane} size={24} />
        </Button>
      </div>

      <div className="flex items-center gap-[10px]">
        <div className="flex flex-1 min-w-0 items-center gap-4">
          <Tooltip title="Session settings" position={TooltipPosition.TopLeft}>
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.Ghost}
              content={ButtonContent.Icon}
              aria-label="Session settings"
              onClick={() => actions.settings(sessionId)}
            >
              <Icon iconName={IconName.Gear} size={16} />
            </Button>
          </Tooltip>

          <ModelPicker
            sessionId={sessionId}
            metadata={snapshot?.metadata ?? null}
            label={metrics.model}
            disabled={busy}
          />

          <span className="text-[10px] leading-[12px] font-medium uppercase text-basic-tertiary shrink-0">
            {metrics.env}
          </span>

          {metrics.usage ? (
            <div className="flex items-center gap-1 min-w-0">
              {/* The backend reports the live context window here, not a sum
                  of the columns beside it. */}
              <StatBadge
                iconName={IconName.Timelaps}
                value={formatTokensCompact(metrics.usage.total_tokens)}
                className="text-info-primary"
                title="Orchestrator context"
              />
              <StatBadge
                iconName={IconName.ArrowTop}
                value={formatTokensCompact(metrics.usage.input_tokens)}
                className="text-info-secondary opacity-75"
                title="Input tokens"
              />
              <StatBadge
                iconName={IconName.ArrowDown}
                value={formatTokensCompact(metrics.usage.output_tokens)}
                className="text-info-secondary opacity-75"
                title="Output tokens"
              />
              {/* Priced from the model catalog, so a model the catalog has no
                  rates for shows "--" rather than a misleading zero. */}
              <StatBadge
                iconName={IconName.Money}
                value={formatCostMicros(metrics.usage.cost?.total)}
                className="text-info-secondary opacity-75"
                title="Session cost"
              />
            </div>
          ) : null}
        </div>

        <Tooltip
          title={running ? "Run elapsed" : "Last response time"}
          position={TooltipPosition.TopRight}
        >
          <div
            className={cn(
              "flex items-center gap-1 p-1 shrink-0 label-micro",
              running ? "text-basic-primary" : "text-basic-tertiary",
            )}
          >
            {running ? (
              <Loader size={LoaderSize.Small} />
            ) : (
              <Icon iconName={IconName.History} size={16} />
            )}
            <span className="block w-[36px] text-center">
              {formatClock(elapsedMs)}
            </span>
          </div>
        </Tooltip>
      </div>
    </form>
  );
}
