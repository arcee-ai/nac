import { useId, useState } from "react";

import { Badge, BadgeColor, Icon, IconName } from "@/app/atoms";
import { goalBadgeColor, goalStatusLabel } from "@/app/features/goals/status";
import { cn } from "@/app/lib/cn";
import { shortId } from "@/app/lib/format";
import type { GoalContinuationTurn } from "@/app/lib/transcript";
import { useSessionGoal } from "@/app/services/queries";

/** Past this the objective is clamped until the reader expands it. */
const LONG_OBJECTIVE_CHARS = 280;
const LONG_OBJECTIVE_LINES = 4;

/**
 * Where NAC started a run for a durable goal: the objective the user wrote and
 * the goal it belongs to, in place of the control prompt the model reads. The
 * status is the durable goal's current one; a cleared or replaced goal is no
 * longer the session's goal and says so.
 */
export function GoalContinuationCard({
  sessionId,
  turn,
}: {
  sessionId: string;
  turn: GoalContinuationTurn;
}) {
  const goalQuery = useSessionGoal(sessionId, true);
  const [expanded, setExpanded] = useState(false);
  const objectiveId = useId();
  const goal = goalQuery.data;
  const current = goal != null && goal.goal_id === turn.goalId;
  const ended = goalQuery.isSuccess && !current;
  const long =
    turn.objective.length > LONG_OBJECTIVE_CHARS ||
    turn.objective.split("\n").length > LONG_OBJECTIVE_LINES;
  const title = turn.first ? "Goal started" : "Goal continued";

  return (
    <section aria-label={title} className="py-6 md:pl-2">
      <div className="flex max-w-full flex-col gap-2 rounded-[8px] bg-elevation-level-1 p-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Icon iconName={IconName.Flag} size={16} className="shrink-0 text-basic-secondary" />
          <span className="shrink-0 text-micro font-semibold text-basic-primary">{title}</span>
          {current ? (
            <Badge text={goalStatusLabel(goal.status)} color={goalBadgeColor(goal.status)} />
          ) : ended ? (
            <Badge text="No longer current" color={BadgeColor.Gray} />
          ) : null}
          <span
            className="code code-small min-w-0 truncate text-basic-muted"
            title={`Goal ${turn.goalId}`}
          >
            Goal {shortId(turn.goalId)}
          </span>
        </div>
        <p
          id={objectiveId}
          className={cn(
            "whitespace-pre-wrap break-words text-small text-basic-primary",
            long && !expanded && "line-clamp-4",
          )}
        >
          {turn.objective}
        </p>
        {long ? (
          <button
            type="button"
            className="self-start rounded-[4px] text-micro font-medium text-btn-secondary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-border-focus-outline)]"
            aria-expanded={expanded}
            aria-controls={objectiveId}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "Show less" : "Show full objective"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
