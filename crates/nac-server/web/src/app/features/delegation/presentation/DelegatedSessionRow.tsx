import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import { cn } from "@/app/lib/cn";
import type { DelegatedSessionPresentation } from "@/app/features/delegation/model";

const STATUS_TONE = {
  neutral: "text-basic-secondary",
  active: "text-info-primary",
  success: "text-success-primary",
  danger: "text-error-primary",
  warning: "text-danger-primary",
} satisfies Record<DelegatedSessionPresentation["statusTone"], string>;

export function DelegatedSessionRow({
  session,
  busy = false,
  onOpen,
  onPrompt,
  onCancel,
}: {
  session: DelegatedSessionPresentation;
  busy?: boolean;
  onOpen: () => void;
  onPrompt: () => void;
  onCancel: () => void;
}) {
  return (
    <article
      aria-label={`${session.typeLabel}: ${session.description}`}
      className="rounded-[6px] border border-border-primary p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="break-words text-small font-medium text-basic-primary">
            {session.description}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-basic-tertiary">
            <span>{session.typeLabel}</span>
            <span aria-hidden="true">·</span>
            <span role="status" className={cn("font-medium", STATUS_TONE[session.statusTone])}>
              {session.statusLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span>Generation {session.generation}</span>
            {session.modeLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{session.modeLabel}</span>
              </>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-basic-muted" title={session.updatedLabel}>
            Updated {session.updatedLabel}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size={ButtonSize.Small} variant={ButtonVariant.Ghost} onClick={onOpen}>
            Open
          </Button>
          <Button size={ButtonSize.Small} variant={ButtonVariant.Ghost} onClick={onPrompt}>
            {session.canSteer ? "Steer" : "Continue"}
          </Button>
          {session.canCancel ? (
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.GhostDestructive}
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
      {session.outcome ? (
        <div className="mt-3 border-t border-border-primary pt-2 text-xs text-basic-secondary">
          <span className="font-medium text-basic-primary">{session.outcomeLabel}: </span>
          <span className="whitespace-pre-wrap break-words">{session.outcome}</span>
        </div>
      ) : null}
      {session.completionNeedsAttention ? (
        <div role="status" className="mt-2 text-xs font-medium text-info-primary">
          Completion delivered to this parent
        </div>
      ) : null}
    </article>
  );
}
