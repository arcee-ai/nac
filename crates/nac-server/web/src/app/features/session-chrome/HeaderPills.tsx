import type { ReactNode } from "react";

import { Icon, IconName, Tooltip, TooltipPosition } from "@/app/atoms";
import type { SessionFacts } from "@/app/features/session-chrome/useSessionFacts";
import type { SessionDrawerControls } from "@/app/features/session-chrome/useSessionDrawer";
import { goalStatusLabel } from "@/app/features/session-chrome/goalStatus";
import { cn } from "@/app/lib/cn";

/** "+12 −3", each half only when it has something to count. */
export function ChangeCounts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="tabular flex items-center gap-1">
      {additions ? <span className="text-[var(--f-green-text)]">+{additions}</span> : null}
      {deletions ? <span className="text-[var(--f-red-text)]">−{deletions}</span> : null}
    </span>
  );
}

/**
 * One header chip: a 28px ghost pill with a quiet label, a wash on hover and
 * a firmer one while its drawer is open. The accessible name keeps the panel's
 * name ("Files", "Subagents"…) alongside what the chip shows.
 */
export function HeaderPill({
  label,
  tooltip,
  pressed,
  onClick,
  children,
  className,
}: {
  label: string;
  tooltip: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip title={tooltip} position={TooltipPosition.BottomCenter}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={pressed}
        onClick={onClick}
        className={cn(
          "type-label flex h-7 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-basic-secondary outline-none",
          "transition-[background-color,color] duration-150 ease-out motion-reduce:transition-none",
          "hover:bg-[var(--f-wash-2)] hover:text-basic-primary focus-visible:ring-2 focus-visible:ring-[var(--f-focus)]",
          "animate-[fade_160ms_ease-out] motion-reduce:animate-none",
          pressed && "bg-[var(--f-wash-3)] text-basic-primary",
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * The contextual pills, in their fixed order: changes, agents, goal,
 * terminal, schedules. Each renders only when it has something to say, so a
 * quiet session's header is its title alone.
 */
export function HeaderPills({
  facts,
  drawer,
}: {
  facts: SessionFacts;
  drawer: SessionDrawerControls;
}) {
  const panels = facts.policy?.widePanels ?? [];
  const pills: ReactNode[] = [];

  if (panels.includes("files") && (facts.additions > 0 || facts.deletions > 0)) {
    pills.push(
      <HeaderPill
        key="files"
        label={`Files: +${facts.additions} −${facts.deletions}`}
        tooltip="Changes"
        pressed={drawer.showing("files")}
        onClick={() => drawer.toggle("files")}
      >
        <ChangeCounts additions={facts.additions} deletions={facts.deletions} />
      </HeaderPill>,
    );
  }

  const agents = facts.agents;
  if (agents) {
    const noun = `${agents.noun}${agents.count === 1 ? "" : "s"}`;
    const running = agents.running > 0 ? `, ${agents.running} running` : "";
    pills.push(
      <HeaderPill
        key="agents"
        label={`${agents.noun === "agent" ? "Subagents" : "Threads"}: ${agents.count} ${noun}${running}`}
        tooltip={agents.noun === "agent" ? "Subagents" : "Threads and worksets"}
        pressed={drawer.showing(agents.panel)}
        onClick={() => drawer.toggle(agents.panel)}
      >
        {agents.running > 0 ? (
          <span aria-hidden className="status-dot-pulse size-1.5 rounded-pill bg-[var(--f-ink)]" />
        ) : null}
        <span className="tabular">
          {agents.count} {noun}
        </span>
      </HeaderPill>,
    );
  }

  if (facts.goal) {
    const goal = facts.goal;
    const quiet = goal.status === "active";
    pills.push(
      <HeaderPill
        key="goal"
        label={`Goal: ${goalStatusLabel(goal.status)}`}
        tooltip={goal.objective}
        pressed={drawer.showing("goal")}
        onClick={() => drawer.toggle("goal")}
      >
        <Icon iconName={IconName.Goal} size={16} className="shrink-0" />
        <span>Goal</span>
        {quiet ? null : (
          <span
            className={cn(
              "type-meta",
              goal.status === "complete"
                ? "text-[var(--f-green-text)]"
                : goal.status === "paused"
                  ? "text-basic-tertiary"
                  : "text-[var(--f-amber-text)]",
            )}
          >
            {goalStatusLabel(goal.status)}
          </span>
        )}
      </HeaderPill>,
    );
  }

  if (facts.terminal) {
    pills.push(
      <HeaderPill
        key="terminal"
        label="Terminal"
        tooltip="Terminal"
        pressed={drawer.showing("terminal")}
        onClick={() => drawer.toggle("terminal")}
        className="w-7 justify-center px-0"
      >
        <Icon iconName={IconName.Terminal} size={16} />
      </HeaderPill>,
    );
  }

  if (panels.includes("heartbeats") && facts.schedules > 0) {
    pills.push(
      <HeaderPill
        key="heartbeats"
        label={`Heartbeats: ${facts.schedules} ${facts.schedules === 1 ? "schedule" : "schedules"}`}
        tooltip="Schedules"
        pressed={drawer.showing("heartbeats")}
        onClick={() => drawer.toggle("heartbeats")}
      >
        <Icon iconName={IconName.Clock} size={16} className="shrink-0" />
        <span className="tabular">{facts.schedules}</span>
      </HeaderPill>,
    );
  }

  return pills.length > 0 ? <div className="flex items-center gap-0.5">{pills}</div> : null;
}
