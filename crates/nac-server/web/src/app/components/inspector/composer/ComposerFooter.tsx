import type { PointerEvent, ReactNode } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { PermissionControls } from "@/app/components/inspector/PermissionControls";
import { SshBadge } from "@/app/components/SshBadge";
import { contextShare, resolveCatalogModel } from "@/app/lib/catalog";
import { cn } from "@/app/lib/cn";
import { formatTokensCompact } from "@/app/lib/format";
import { useModelCatalog } from "@/app/services/queries";
import type { SessionBehavior, SessionMetadata } from "@/app/types/api";

import { ComposerMenu, type ComposerMenuProps } from "./ComposerMenu";

/** The ring stays out of the way until the context is worth watching. */
const RING_FROM = 0.6;
/** From here the ring turns amber and offers to compact. */
const COMPACT_FROM = 0.8;

export type SubmitMode = "send" | "steer" | "stop" | "stopping";

export interface ComposerSubmit {
  mode: SubmitMode;
  /** Whether the field holds something that can go out now. */
  canSend: boolean;
  /** A direct run takes the text as the next turn instead of a steer. */
  onQueue: (() => void) | null;
  onStop: () => void;
  /** Keeps an open suggestion's focus through the press. */
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
}

export interface ComposerFooterProps {
  sessionId: string;
  behavior: SessionBehavior | null;
  compact: boolean;
  menu: Omit<ComposerMenuProps, "sessionId" | "compact">;
  metadata: SessionMetadata | null;
  modelLabel: string;
  modelDisabled: boolean;
  ssh: { connected: boolean; onReconnect: () => void } | null;
  permissionSheet: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    focusKey: string | null;
  };
  /** Session settings, until the session header's ⋯ menu carries it. */
  onSettings: (() => void) | null;
  contextTokens: number | null;
  onCompact: (() => void) | null;
  compacting: boolean;
  submit: ComposerSubmit;
}

/**
 * The one row under the message: `+`, the model chip, the permission chip,
 * and Send in its context ring. Nothing else lives here; everything that asks
 * for a decision rides in the attention card above the composer instead.
 */
export function ComposerFooter({
  sessionId,
  behavior,
  compact,
  menu,
  metadata,
  modelLabel,
  modelDisabled,
  ssh,
  permissionSheet,
  onSettings,
  contextTokens,
  onCompact,
  compacting,
  submit,
}: ComposerFooterProps) {
  const catalog = useModelCatalog();
  const resolved = resolveCatalogModel(
    catalog.data,
    metadata?.backend,
    metadata?.model ?? modelLabel,
  );
  const contextWindow = resolved.contextWindow;
  const share =
    contextWindow && contextTokens != null ? Math.min(contextTokens / contextWindow, 1) : null;
  const nearlyFull = share !== null && share >= COMPACT_FROM;

  return (
    // Wraps rather than letting its `shrink-0` controls run into each other
    // on a phone, where Queue and the model label compete for the width.
    <div className="flex min-h-10 flex-wrap items-center gap-x-1 gap-y-1">
      <ComposerMenu sessionId={sessionId} compact={compact} {...menu} />
      {/* Breaks the line at a fixed width and grows back to its own, so a
          run's Queue shortens the model label instead of moving the row. */}
      <div className="flex min-w-0 grow basis-[140px] max-w-fit items-center">
        <ModelPicker
          sessionId={sessionId}
          metadata={metadata}
          label={modelLabel}
          disabled={modelDisabled}
        />
      </div>
      {ssh ? (
        <SshBadge
          className="mx-1"
          state={ssh.connected ? "connected" : "reconnect"}
          onReconnect={ssh.onReconnect}
        />
      ) : null}
      <PermissionControls
        sessionId={sessionId}
        behavior={behavior}
        compact={compact}
        sheetOpen={permissionSheet.open}
        onSheetOpenChange={permissionSheet.onOpenChange}
        focusRequestKey={permissionSheet.focusKey}
      />
      {onSettings ? (
        <Tooltip title="Session settings" position={TooltipPosition.TopCenter}>
          <Button
            type="button"
            size={ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            content={ButtonContent.Icon}
            className={compact ? "!size-11 !min-h-11 !min-w-11" : undefined}
            aria-label="Session settings"
            onClick={onSettings}
          >
            <Icon iconName={IconName.Gear} size={16} />
          </Button>
        </Tooltip>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {nearlyFull && onCompact ? (
          <Button
            type="button"
            size={compact ? ButtonSize.Large : ButtonSize.Small}
            variant={ButtonVariant.Ghost}
            className="!text-[var(--f-amber-text)]"
            aria-label="Compact context"
            loading={compacting}
            disabled={compacting}
            onClick={onCompact}
          >
            Compact
          </Button>
        ) : null}
        {/* Queue only means something once there is text to queue. */}
        {submit.onQueue && submit.mode !== "stop" ? (
          <Button
            type="button"
            size={compact ? ButtonSize.Large : ButtonSize.Medium}
            variant={ButtonVariant.Secondary}
            aria-label="Queue Next"
            title="Send after this run finishes"
            disabled={!submit.canSend}
            onPointerDown={submit.onPointerDown}
            onClick={submit.onQueue}
          >
            Queue
          </Button>
        ) : null}
        <ContextRing
          share={share}
          tokens={contextTokens}
          contextWindow={contextWindow}
          budgetDescription={contextShare(contextTokens, resolved)}
          compact={compact}
        >
          <SubmitButton submit={submit} compact={compact} />
        </ContextRing>
      </div>
    </div>
  );
}

function SubmitButton({ submit, compact }: { submit: ComposerSubmit; compact: boolean }) {
  const { mode } = submit;
  const stopping = mode === "stopping";
  const stop = mode === "stop";
  const steer = mode === "steer";
  const label = stopping ? "Stopping run" : stop ? "Stop run" : steer ? "Steer active run" : "Send";
  return (
    <Button
      size={compact ? ButtonSize.Large : ButtonSize.Medium}
      variant={ButtonVariant.Primary}
      content={steer ? ButtonContent.IconRight : ButtonContent.Icon}
      type={stop || stopping ? "button" : "submit"}
      className={cn(
        "shrink-0 transition-[width,background-color] duration-150 ease-out",
        compact && !steer && "!size-11 !min-h-11 !min-w-11",
        steer && "!px-3.5",
      )}
      disabled={stopping || (!stop && !submit.canSend)}
      loading={stopping}
      aria-label={label}
      title={steer ? "Steer the running agent with this message" : undefined}
      onPointerDown={submit.onPointerDown}
      onClick={stop ? submit.onStop : undefined}
    >
      {steer ? <span className="type-label">Steer</span> : null}
      <Icon iconName={stop ? IconName.Stop : IconName.ArrowTop} size={steer ? 16 : 18} />
    </Button>
  );
}

/**
 * The context gauge drawn around Send: absent below 60%, ink to 80%, amber
 * from there, where the footer also offers Compact.
 */
function ContextRing({
  share,
  tokens,
  contextWindow,
  budgetDescription,
  compact,
  children,
}: {
  share: number | null;
  tokens: number | null;
  contextWindow: number | null;
  budgetDescription: string | null;
  compact: boolean;
  children: ReactNode;
}) {
  if (share === null || share < RING_FROM) return <>{children}</>;
  const size = compact ? 52 : 40;
  const stroke = 2;
  const radius = size / 2 - stroke;
  const circumference = 2 * Math.PI * radius;
  const amber = share >= COMPACT_FROM;
  const percent = Math.round(share * 100);
  return (
    <Tooltip
      title={`Context ${percent}% full`}
      description={`${formatTokensCompact(tokens)} of ${formatTokensCompact(contextWindow)} input tokens. ${budgetDescription ?? ""}${
        amber ? " Compact to summarize earlier turns and free room." : ""
      }`}
      position={TooltipPosition.TopLeft}
    >
      <span className="relative inline-flex shrink-0 items-center justify-center">
        <svg
          aria-hidden
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-[var(--f-wash-3)]"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - share)}
            className={cn(
              "transition-[stroke-dashoffset] duration-200 ease-out motion-reduce:transition-none",
              amber ? "stroke-[var(--f-amber)]" : "stroke-[var(--f-ink-4)]",
            )}
          />
        </svg>
        <span className="sr-only">Context {percent}% full</span>
        {children}
      </span>
    </Tooltip>
  );
}
