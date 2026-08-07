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
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { useNow } from "@/app/hooks/useNow";
import { perfRender } from "@/app/lib/perfDebug";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import {
  useModelCatalog,
  useSshConnect,
  useSubmitRun,
} from "@/app/services/queries";
import { pushLocalEvent, useRunning } from "@/app/store/runtimeStore";
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
  value,
  iconSize = 14,
  className,
  title,
}: {
  iconName: IconName;
  value: string;
  iconSize?: 14 | 16;
  className?: string;
  title: string;
}) {
  return (
    <Tooltip title={title} position={TooltipPosition.TopCenter}>
      <div
        className={cn(
          "flex items-center gap-[2px] py-1 whitespace-nowrap",
          className,
        )}
      >
        <Icon iconName={iconName} size={iconSize} />
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
  const isMobile = useIsMobile();
  const running = useRunning();
  const toast = useToast();
  const actions = useSessionActions();
  const submitRun = useSubmitRun();
  const ref = useRef<HTMLTextAreaElement>(null);

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

  const busy = submitRun.isPending || running;
  const canSend = Boolean(value.trim()) && !busy;

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

  const settingsButton = (
    <Tooltip title="Session settings" position={TooltipPosition.TopLeft}>
      <Button
        size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label="Session settings"
        onClick={() => actions.settings(sessionId)}
      >
        <Icon iconName={IconName.Gear} size={isMobile ? 24 : 16} />
      </Button>
    </Tooltip>
  );

  const sendButton = (
    <Button
      className={isMobile ? "shrink-0 rounded-[32px]" : "absolute bottom-0 right-0"}
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
  );

  const field = (
    <div
      className={cn(
        "relative flex items-end bg-input",
        isMobile
          ? "flex-1 min-w-0 rounded-[20px] shadow-2xl pr-[44px]"
          : "rounded-[4px] shadow-concave pr-[48px]",
      )}
    >
      <textarea
        ref={ref}
        className={cn(
          "flex-1 min-w-0 bg-transparent resize-none border-none outline-none text-medium text-input placeholder:text-input-placeholder",
          isMobile ? "px-4 py-3" : "p-3",
        )}
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
      {/* On a phone the settings glyph rides inside the pill and Send sits
          outside it, the way the design draws the two controls. */}
      {isMobile ? (
        <div className="absolute top-0 right-0">{settingsButton}</div>
      ) : (
        sendButton
      )}
    </div>
  );

  return (
    <form
      className={cn(
        "flex flex-col",
        isMobile
          ? "gap-2"
          : "gap-4 p-4 rounded-[8px] bg-elevation-level-1 shadow-2xl",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {isMobile ? (
        <div className="flex items-end gap-2">
          {field}
          {sendButton}
        </div>
      ) : (
        field
      )}

      {/* The status line wraps rather than letting its `shrink-0` chips run
          into each other once the chat column is narrow. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-[10px]",
          isMobile && "px-1 pb-1",
        )}
      >
        <div
          className={cn(
            "flex flex-1 min-w-0 flex-wrap items-center gap-y-1",
            isMobile ? "gap-x-2" : "gap-x-4",
          )}
        >
          {isMobile ? null : settingsButton}

          <ModelPicker
            sessionId={sessionId}
            metadata={snapshot?.metadata ?? null}
            label={metrics.model}
            disabled={busy}
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
              {/* The per-direction columns are the first thing to go when the
                  row has a phone's width to work with. */}
              {isMobile ? null : (
                <>
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
                </>
              )}
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
