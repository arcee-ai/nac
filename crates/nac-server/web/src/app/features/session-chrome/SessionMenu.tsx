import { useContext, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Icon, IconName, Popover, PopoverPlacement, Tooltip, TooltipPosition } from "@/app/atoms";
import { BranchPicker } from "@/app/components/inspector/BranchPicker";
import { RevisionPicker } from "@/app/components/inspector/RevisionPicker";
import { SessionUsageReadings } from "@/app/components/inspector/SessionUsage";
import { TranscriptModelContext } from "@/app/components/inspector/transcript/TranscriptModelContext";
import { PANEL_ICON } from "@/app/components/inspector/sessionPanelIcons";
import { goalStatusLabel } from "@/app/features/session-chrome/goalStatus";
import { ChangeCounts } from "@/app/features/session-chrome/HeaderPills";
import type { SessionDrawerControls } from "@/app/features/session-chrome/useSessionDrawer";
import type { SessionFacts } from "@/app/features/session-chrome/useSessionFacts";
import { useUsageReadings } from "@/app/features/session-chrome/useUsageReadings";
import { SessionIntegrations } from "@/app/features/session-integrations/SessionIntegrations";
import { useUiPolicy } from "@/app/features/ui-policy/UiPolicyContext";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { routes, SESSION_PANEL_LABEL, type SessionPanel } from "@/app/lib/routes";
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

/** Phone panel rows, in the order the spec lists them. */
const PHONE_ORDER: readonly (SessionPanel | "goal")[] = [
  "files",
  "delegated",
  "worksets",
  "terminal",
  "goal",
  "heartbeats",
  "insights",
  "history",
];

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
 * The session's details and actions behind one ⋯: where it runs, its branch
 * and snapshot, usage, integrations, then settings, Insights, fork, rename
 * and delete. On a phone the same sheet first lists the session's panels,
 * because the header has room for only one button.
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

  const panels = facts.policy?.mobilePanels ?? [];
  const phoneRows = PHONE_ORDER.filter((name) =>
    name === "goal" ? facts.goal != null : panels.includes(name),
  );
  const panelDetail = (name: SessionPanel | "goal"): ReactNode => {
    if (name === "files" && (facts.additions || facts.deletions))
      return <ChangeCounts additions={facts.additions} deletions={facts.deletions} />;
    if ((name === "delegated" || name === "worksets") && facts.agents?.panel === name)
      return `${facts.agents.count}${facts.agents.running ? ` · ${facts.agents.running} running` : ""}`;
    if (name === "goal" && facts.goal) return goalStatusLabel(facts.goal.status);
    if (name === "heartbeats" && facts.schedules) return String(facts.schedules);
    return null;
  };

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
      {phone && phoneRows.length > 0 ? (
        <Section title="Panels">
          {phoneRows.map((name) => (
            <ActionRow
              key={name}
              icon={name === "goal" ? IconName.Goal : PANEL_ICON[name]}
              label={name === "goal" ? "Goal" : SESSION_PANEL_LABEL[name]}
              detail={panelDetail(name)}
              selected={drawer.showing(name)}
              onClick={run(() =>
                name === "goal" ? drawer.toggle("goal") : drawer.openPanel(name),
              )}
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
        {phone ? null : (
          <ActionRow
            icon={PANEL_ICON.insights}
            label="Insights"
            selected={drawer.showing("insights")}
            onClick={run(() => drawer.openPanel("insights"))}
          />
        )}
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
 * The trigger and its panel. Desktop: a 28px ⋯ chip at the end of the pills,
 * opening a popover. Phone: the header's one "panels" button, opening the
 * same content as a bottom sheet with the panel list on top.
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
  const trigger = phone ? (
    <button
      type="button"
      aria-label="Open panel"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className="flex size-11 items-center justify-center rounded-pill text-basic-secondary outline-none hover:bg-[var(--f-wash-2)] focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]"
    >
      <Icon iconName={IconName.MenuHorizontal} />
    </button>
  ) : (
    <Tooltip title="Session details and actions" position={TooltipPosition.BottomLeft}>
      <button
        type="button"
        aria-label="Session menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex size-7 items-center justify-center rounded-pill text-basic-secondary outline-none",
          "transition-colors duration-150 ease-out hover:bg-[var(--f-wash-2)] hover:text-basic-primary",
          "focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
          open && "bg-[var(--f-wash-3)] text-basic-primary",
        )}
      >
        <Icon iconName={IconName.MenuHorizontal} size={16} />
      </button>
    </Tooltip>
  );
  return (
    <Popover
      open={open}
      onClose={close}
      sticky
      focusScope="Session"
      placement={PopoverPlacement.BottomLeft}
      size="w-[320px]"
      className="shrink-0"
      sheetClassName="px-2"
      content={<SessionMenuContent {...props} phone={phone} close={close} />}
    >
      {trigger}
    </Popover>
  );
}
