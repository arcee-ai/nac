import { useContext, useId, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, IconName, Popover, PopoverPlacement, Tooltip, TooltipPosition } from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { RevisionPicker } from "@/app/components/inspector/RevisionPicker";
import { SessionUsageReadings } from "@/app/components/inspector/SessionUsage";
import { TranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import { PANEL_ICON } from "@/app/components/inspector/sessionPanelIcons";
import { goalStatusLabel } from "@/app/features/session-chrome/goalStatus";
import {
  sessionLiveFacts,
  sessionPanelEntries,
  type SessionPanelTarget,
} from "@/app/features/session-chrome/sessionPanelEntries";
import type { SessionDrawerControls } from "@/app/features/session-chrome/useSessionDrawer";
import type { SessionFacts } from "@/app/features/session-chrome/useSessionFacts";
import { useUsageReadings } from "@/app/features/session-chrome/useUsageReadings";
import { SessionIntegrations } from "@/app/features/session-integrations/SessionIntegrations";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes, SESSION_PANEL_LABEL } from "@/app/lib/routes";
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useForkSession } from "@/app/services/queries";
import type { ManagedSessionSummary, SessionSnapshotResponse } from "@/app/types/api";

/** Display vocabulary for the immutable persisted behaviors. */
const BEHAVIOR_LABEL: Record<NonNullable<SessionFacts["behavior"]>, string> = {
  direct: "Agent",
  "direct-with-orchestrator": "Agent + Orchestrator",
  orchestrator: "Orchestrator",
};

/** "+12 −3", each half only when it has something to count. */
export function ChangeCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="tabular flex items-center gap-1">
      {additions ? <span className="text-[var(--f-green-text)]">+{additions}</span> : null}
      {deletions ? <span className="text-[var(--f-red-text)]">−{deletions}</span> : null}
    </span>
  );
}

/** A small ink dot: something in the session is live. It pulses while work runs. */
function LiveDot({ pulse, className }: { pulse: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-pill bg-[var(--f-ink)]",
        pulse && "status-dot-pulse",
        className,
      )}
    />
  );
}

/** A panel row's live fact, after its name: counts, a goal's state. */
function panelDetail(target: SessionPanelTarget, facts: SessionFacts): ReactNode {
  if (target === "files" && (facts.additions || facts.deletions))
    return <ChangeCounts additions={facts.additions} deletions={facts.deletions} />;
  if ((target === "delegated" || target === "worksets") && facts.agents?.panel === target) {
    const { count, running } = facts.agents;
    return (
      <span className="tabular flex items-center gap-1.5">
        {count}
        {running > 0 ? (
          <>
            <LiveDot pulse />
            <span className="sr-only">{`, ${running} running`}</span>
          </>
        ) : null}
      </span>
    );
  }
  if (target === "goal" && facts.goal) return goalStatusLabel(facts.goal.status);
  if (target === "heartbeats" && facts.schedules)
    return <span className="tabular">{facts.schedules}</span>;
  return null;
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5 border-t border-muted px-1 py-1.5 first:border-t-0">
      {title ? (
        <h3 className="type-meta-strong px-2 pt-1 pb-0.5 text-basic-tertiary">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3 px-2 max-md:min-h-11">
      <span className="type-meta w-20 shrink-0 text-basic-tertiary">{label}</span>
      <div className="type-meta flex min-w-0 flex-1 items-center justify-end text-basic-primary [&_.btn]:max-w-full">
        {children}
      </div>
    </div>
  );
}

function ActionRow({
  icon,
  label,
  detail,
  destructive = false,
  disabled = false,
  selected,
  onClick,
}: {
  icon: IconName;
  label: string;
  detail?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={selected ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "type-body-chrome flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left outline-none max-md:h-11",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "hover:bg-[var(--f-wash-2)] focus-visible:bg-[var(--f-wash-2)] disabled:pointer-events-none disabled:opacity-45",
        destructive ? "text-error-primary" : "text-basic-primary",
        selected && "bg-[var(--f-wash-2)]",
      )}
    >
      <Icon iconName={icon} size={16} className={destructive ? "" : "text-basic-tertiary"} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail ? <span className="type-meta shrink-0 text-basic-tertiary">{detail}</span> : null}
    </button>
  );
}

/**
 * Everything the session header used to spread across pills and ⋯, in one
 * list: the session's panels with their live facts (a row opens the drawer on
 * it), then where it runs, its branch and snapshot, integrations and usage,
 * then settings, fork, rename and delete. The same content is a popover on a
 * wide screen and a bottom sheet on a phone.
 */
function SessionMenuContent({
  sessionId,
  snapshot,
  entry,
  facts,
  drawer,
  phone,
  close,
}: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
  facts: SessionFacts;
  drawer: SessionDrawerControls;
  phone: boolean;
  close: () => void;
}) {
  const { useSelectedRevision, selectRevision } = useNativeRuntime().stores.sessionLayoutStore;
  const selectedRevision = useSelectedRevision();
  const actions = useSessionActions();
  const usage = useUsageReadings(sessionId, snapshot, entry);
  const model = useContext(TranscriptModelContext);
  const forkSession = useForkSession();
  const navigate = useNavigate();
  const toast = useToast();
  const summary = entry?.summary ?? null;
  const uiPolicy = useUiPolicy();

  const forkIndex = [...(model?.baseTurns ?? [])]
    .reverse()
    .find((turn) => turn.kind === "model" && turn.messageIndex != null)?.messageIndex;
  const canFork = !facts.readOnly && forkIndex != null && !facts.running && !forkSession.isPending;
  const fork = () => {
    if (forkIndex == null) return;
    close();
    void forkSession
      .mutateAsync({ id: sessionId, messageIdx: forkIndex })
      .then((response) => navigate(routes.session(response.session_id)))
      .catch((error: unknown) =>
        toast.error(
          `Failed to create fork: ${humanErrorText(toRunError(error), summary?.backend)}`,
        ),
      );
  };
  const run = (act: () => void) => () => {
    close();
    act();
  };

  const entries = sessionPanelEntries(facts, phone);

  const kind =
    facts.lineage?.kind === "managed-orchestrator"
      ? "Managed orchestrator"
      : facts.lineage
        ? "Subagent"
        : facts.behavior && uiPolicy.orchestrationEnabled
          ? BEHAVIOR_LABEL[facts.behavior]
          : null;
  const place = [facts.environment, entry?.summary.ssh_host ?? facts.repo]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col">
      {entries.length > 0 ? (
        <Section title="Panels">
          {entries.map((target) => (
            <ActionRow
              key={target}
              icon={target === "goal" ? IconName.Goal : PANEL_ICON[target]}
              label={target === "goal" ? "Goal" : SESSION_PANEL_LABEL[target]}
              detail={panelDetail(target, facts)}
              selected={drawer.showing(target)}
              onClick={run(() => drawer.show(target))}
            />
          ))}
        </Section>
      ) : null}

      <Section title="Details">
        <DetailRow label="Environment">
          <span className="truncate" title={entry?.summary.cwd ?? undefined}>
            {place || facts.environment}
          </span>
        </DetailRow>
        {kind ? <DetailRow label="Type">{kind}</DetailRow> : null}
        {facts.branch ? (
          <DetailRow label="Branch">
            {facts.readOnly ? (
              <span className="truncate">{facts.branch}</span>
            ) : (
              <BranchPicker
                sessionId={sessionId}
                branch={facts.branch}
                placement={PopoverPlacement.BottomLeft}
                tertiary
              />
            )}
          </DetailRow>
        ) : null}
        <DetailRow label="Snapshot">
          <RevisionPicker
            sessionId={sessionId}
            selected={selectedRevision}
            onSelect={selectRevision}
            placement={PopoverPlacement.BottomLeft}
          />
        </DetailRow>
        {facts.readOnly ? null : (
          <div className="flex min-h-8 items-center px-1 max-md:min-h-11">
            <SessionIntegrations key={sessionId} sessionId={sessionId} />
          </div>
        )}
      </Section>

      <Section title="Usage">
        <div className="px-2 pb-1">
          <SessionUsageReadings {...usage} />
        </div>
      </Section>

      <Section>
        <ActionRow
          icon={IconName.Gear}
          label="Session settings"
          onClick={run(() => actions.settings(sessionId))}
        />
        {facts.readOnly ? null : (
          <ActionRow
            icon={IconName.FileCopy}
            label="Fork from latest reply"
            disabled={!canFork}
            onClick={fork}
          />
        )}
        {summary && !facts.readOnly ? (
          <>
            <ActionRow
              icon={IconName.Edit}
              label="Rename"
              onClick={run(() => actions.rename(summary))}
            />
            <ActionRow
              icon={IconName.Trash}
              label="Delete"
              destructive
              onClick={run(() => actions.remove(summary))}
            />
          </>
        ) : null}
      </Section>
    </div>
  );
}

/**
 * The session header's one control. Its accessible name stays "Session menu"
 * on a wide screen ("Open panel" on a phone) whatever it shows; a small ink
 * dot at its corner says something in the session's background is live
 * (running subagents, an active goal, an armed schedule), and its description
 * says what. Desktop: a 28px ⋯ chip opening a popover. Phone: a 44px button
 * opening the same content as a bottom sheet.
 */
export function SessionMenu(props: {
  sessionId: string;
  snapshot: SessionSnapshotResponse | null;
  entry: ManagedSessionSummary | null;
  facts: SessionFacts;
  drawer: SessionDrawerControls;
}) {
  const phone = useIsMobile();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const live = sessionLiveFacts(props.facts);
  const describedBy = useId();
  const pulse = (props.facts.agents?.running ?? 0) > 0;
  const dot =
    live.length > 0 ? (
      <LiveDot
        pulse={pulse}
        className={cn("absolute", phone ? "top-2.5 right-2.5" : "top-0.5 right-0.5")}
      />
    ) : null;
  const description =
    live.length > 0 ? (
      <span id={describedBy} className="sr-only">
        {live.join(", ")}
      </span>
    ) : null;
  const button = (
    <button
      type="button"
      aria-label={phone ? "Open panel" : "Session menu"}
      aria-describedby={live.length > 0 ? describedBy : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn(
        "relative flex items-center justify-center rounded-pill text-basic-secondary outline-none",
        "transition-colors duration-150 ease-out motion-reduce:transition-none",
        "hover:bg-[var(--f-wash-2)] hover:text-basic-primary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
        phone ? "size-11" : "size-7",
        open && "bg-[var(--f-wash-3)] text-basic-primary",
      )}
    >
      <Icon iconName={IconName.MenuHorizontal} size={phone ? 20 : 16} />
      {dot}
      {description}
    </button>
  );
  const tooltip = ["Panels, details and actions", ...live].join(" · ");
  return (
    <Popover
      open={open}
      onClose={close}
      sticky
      focusScope="Session"
      placement={PopoverPlacement.BottomLeft}
      size="w-[320px]"
      className="shrink-0"
      panelClassName="max-h-(--radix-popover-content-available-height) overflow-y-auto"
      sheetClassName="px-2"
      content={<SessionMenuContent {...props} phone={phone} close={close} />}
    >
      {phone ? (
        button
      ) : (
        <Tooltip title={tooltip} position={TooltipPosition.BottomLeft}>
          {button}
        </Tooltip>
      )}
    </Popover>
  );
}
