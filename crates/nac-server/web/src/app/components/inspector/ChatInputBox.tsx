import { useCallback, useEffect, useRef, useState } from "react";

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
import { GuidanceControl } from "@/app/components/inspector/GuidanceControl";
import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { SshBadge } from "@/app/components/SshBadge";
import {
  resolveCatalogModel,
  type ResolvedCatalogModel,
} from "@/app/lib/catalog";
import { cn } from "@/app/lib/cn";
import {
  ENV_SSH,
  formatClock,
  formatCostMicros,
  formatTokensCompact,
  runMetrics,
  sessionEnvLabel,
} from "@/app/lib/format";
import { useNow } from "@/app/hooks/useNow";
import { perfRender } from "@/app/lib/perfDebug";
import { ApiError } from "@/app/services/api";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  useGuideCurrentRun,
  useModelCatalog,
  useSshConnect,
  useSubmitRun,
} from "@/app/services/queries";
import {
  pushLocalEvent,
  setGuidanceStatus,
  useGuidanceStatus,
  useRunning,
} from "@/app/store/runtimeStore";
import {
  markSshConnected,
  markSshDisconnected,
  sshTargetFromSummary,
  useSshConnectionStatus,
} from "@/app/store/sshConnectionStore";
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
  prefix,
  value,
  iconSize = 14,
  className,
  title,
}: {
  iconName?: IconName;
  prefix?: string;
  value: string;
  iconSize?: 14 | 16;
  className?: string;
  title: string;
}) {
  return (
    <Tooltip title={title} position={TooltipPosition.TopCenter}>
      <div className={cn("flex items-center gap-[2px] py-1", className)}>
        {prefix ? (
          <span className="label-micro">{prefix}</span>
        ) : (
          iconName && <Icon iconName={iconName} size={iconSize} />
        )}
        <span className="label-micro">{value}</span>
      </div>
    </Tooltip>
  );
}

/**
 * Context reading against the catalog's window: "6.8K / 200K" for a model the
 * catalog knows, and the same with an "est." marker and no percentage when the
 * window is only the provider's default — the figure itself is a guess then.
 */
function contextGauge(
  used: number | null,
  resolved: ResolvedCatalogModel,
): { value: string; title: string } {
  const tokens = formatTokensCompact(used);
  const window = resolved.contextWindow;
  if (!window || used == null) {
    return { value: tokens, title: "Orchestrator context" };
  }
  const limit = formatTokensCompact(window);
  if (resolved.estimated) {
    return {
      value: `${tokens} / ${limit} est.`,
      title: `Orchestrator context against ${resolved.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate`,
    };
  }
  return {
    value: `${tokens} / ${limit}`,
    title: `Orchestrator context — ${Math.round((used / window) * 100)}% of the model's context window`,
  };
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
  const guideRun = useGuideCurrentRun();
  const guidance = useGuidanceStatus();
  const ref = useRef<HTMLTextAreaElement>(null);
  const retryRef = useRef<{ prompt: string; clientMessageId: string } | null>(null);

  const metrics = runMetrics(snapshot, entry);
  const catalog = useModelCatalog();
  const context = contextGauge(
    metrics.usage?.total_tokens ?? null,
    resolveCatalogModel(
      catalog.data,
      snapshot?.metadata?.backend,
      metrics.model,
    ),
  );
  const now = useNow(1000, running);
  const elapsedMs = metrics.startedAt
    ? now - metrics.startedAt
    : metrics.lastResponseMs;

  const sshTarget = sshTargetFromSummary(entry?.summary);
  const sshStatus = useSshConnectionStatus(sshTarget);
  const connectSsh = useSshConnect();
  const isSsh = sessionEnvLabel(entry?.summary) === ENV_SSH;

  const busy = submitRun.isPending;
  const activeRunId = snapshot?.active_run?.run_id ?? null;
  const queued = snapshot?.queued_message;
  const canSend = Boolean(value.trim()) && !busy && !queued;

  useEffect(() => {
    const latest = snapshot?.thread_steering
      .filter(
        (record) =>
          record.thread_name === "__orchestrator__" &&
          record.dispatch_id === activeRunId,
      )
      .at(-1);
    if (!latest || guidance?.status === "error") return;
    setGuidanceStatus({
      steeringId: latest.id,
      runId: latest.dispatch_id ?? "",
      status:
        latest.status === "delivered"
          ? "delivered"
          : latest.status === "expired"
            ? "expired"
            : "queued",
    });
  }, [snapshot?.thread_steering, activeRunId, guidance?.status]);

  const reconnectSsh = useCallback(async () => {
    if (!sshTarget || connectSsh.isPending) return;
    try {
      await connectSsh.mutateAsync(sshTarget);
      markSshConnected(sshTarget);
    } catch (error) {
      markSshDisconnected(sshTarget);
      toast.error(`SSH reconnect failed: ${errorMessage(error)}`);
    }
  }, [sshTarget, connectSsh, toast]);

  const submit = useCallback(async () => {
    const prompt = value.trim();
    if (!prompt || busy || queued) return;
    const pending = retryRef.current;
    const clientMessageId =
      pending?.prompt === prompt ? pending.clientMessageId : crypto.randomUUID();
    retryRef.current = { prompt, clientMessageId };
    try {
      const response = await submitRun.mutateAsync({
        id: sessionId,
        prompt,
        clientMessageId,
      });
      retryRef.current = null;
      pushLocalEvent(
        "run",
        response.disposition === "queued"
          ? `◇ queued: ${prompt.slice(0, 80)}`
          : `▶ submitted: ${prompt.slice(0, 80)}`,
      );
      setValue("");
      if (ref.current) {
        ref.current.style.height = "auto";
        ref.current.focus();
      }
    } catch (error) {
      // A received HTTP response is definitive. Network failures are ambiguous,
      // so retrying the unchanged prompt keeps the same idempotency key.
      if (error instanceof ApiError) retryRef.current = null;
      const message = errorMessage(error);
      pushLocalEvent("error", `submit failed: ${message}`, true);
      toast.error(`Failed to send: ${message}`);
    }
  }, [value, busy, queued, sessionId, submitRun, toast]);

  const guide = useCallback(
    async (instruction: string) => {
      if (!activeRunId || !running) return false;
      try {
        const response = await guideRun.mutateAsync({
          id: sessionId,
          instruction,
          expectedRunId: activeRunId,
        });
        setGuidanceStatus({
          steeringId: response.steering_id,
          runId: activeRunId,
          status: "queued",
        });
        return true;
      } catch (error) {
        const message = errorMessage(error);
        setGuidanceStatus({
          steeringId: null,
          runId: activeRunId,
          status: "error",
          message,
        });
        pushLocalEvent("error", `guidance failed: ${message}`, true);
        return false;
      }
    },
    [activeRunId, running, guideRun, sessionId],
  );

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
      <div
        className={cn(
          "relative flex items-end rounded-[4px] bg-input shadow-concave",
          running ? "pr-[96px]" : "pr-[48px]",
        )}
      >
        <textarea
          ref={ref}
          className="flex-1 min-w-0 bg-transparent resize-none border-none outline-none p-3 text-medium text-input placeholder:text-input-placeholder"
          rows={1}
          placeholder={queued ? "A next message is already queued" : "Send a message"}
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
        {running ? (
          <Button
            className="absolute bottom-0 right-[48px]"
            size={ButtonSize.Large}
            variant={ButtonVariant.Tertiary}
            content={ButtonContent.Icon}
            type="button"
            aria-label="Stop run"
            onClick={() => void stop()}
          >
            <Icon iconName={IconName.Stop} size={24} />
          </Button>
        ) : null}
        <Button
          className="absolute bottom-0 right-0"
          size={ButtonSize.Large}
          variant={ButtonVariant.Primary}
          content={ButtonContent.Icon}
          type="submit"
          disabled={!canSend}
          aria-label={running ? "Send next message" : "Send"}
        >
          <Icon iconName={IconName.Plane} size={24} />
        </Button>
      </div>
      {running && !queued ? (
        <p className="-mt-3 label-micro text-basic-tertiary">
          Sends after the current run finishes
        </p>
      ) : null}

      <GuidanceControl
        active={Boolean(running && activeRunId)}
        pending={guideRun.isPending}
        status={guidance}
        onSubmit={guide}
      />

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
            disabled={busy || running}
          />

          {isSsh ? (
            <SshBadge
              state={sshStatus === "connected" ? "connected" : "reconnect"}
              onReconnect={() => void reconnectSsh()}
            />
          ) : (
            <span className="text-[10px] leading-[12px] font-medium uppercase text-basic-tertiary shrink-0">
              {metrics.env}
            </span>
          )}

          {metrics.usage ? (
            <div className="flex items-center gap-[2px] min-w-0">
              {/* The backend reports the live context window here, not a sum
                  of the columns beside it. */}
              <StatBadge
                iconName={IconName.Timelaps}
                value={context.value}
                className="text-info-primary"
                title={context.title}
              />
              <StatBadge
                iconName={IconName.ArrowTop}
                value={formatTokensCompact(metrics.usage.input_tokens)}
                className="text-info-secondary opacity-75"
                title="Input tokens"
              />
              {metrics.usage.cache_read_tokens > 0 ? (
                <StatBadge
                  prefix="C"
                  value={formatTokensCompact(metrics.usage.cache_read_tokens)}
                  className="text-info-secondary opacity-75"
                  title="Cache read tokens"
                />
              ) : null}
              <StatBadge
                iconName={IconName.ArrowDown}
                value={formatTokensCompact(metrics.usage.output_tokens)}
                className="text-info-secondary opacity-75"
                title="Output tokens"
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Priced from the model catalog, so a model the catalog has no
              rates for shows "--" rather than a misleading zero. */}
          {metrics.usage ? (
            <StatBadge
              iconName={IconName.Price}
              iconSize={16}
              value={formatCostMicros(metrics.usage.cost?.total)}
              className="text-basic-primary"
              title="Session cost"
            />
          ) : null}

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
              <span className="block w-[40px] text-center">
                {formatClock(elapsedMs)}
              </span>
            </div>
          </Tooltip>
        </div>
      </div>
    </form>
  );
}
