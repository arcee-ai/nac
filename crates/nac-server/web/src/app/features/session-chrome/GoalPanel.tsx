import { useState } from "react";

import {
  Button,
  ButtonSize,
  ButtonVariant,
  Input,
  InputSize,
  TextArea,
  TextAreaSize,
} from "@/app/atoms";
import {
  GOAL_BUDGET_INPUT_RULE,
  parseGoalBudget,
  sameGoalEditableFields,
} from "@/app/features/goals/budget";
import { goalStatusLabel } from "@/app/features/session-chrome/goalStatus";
import { cn } from "@/app/lib/cn";
import { formatClock, formatTokensCompact } from "@/app/lib/format";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useClearGoal, useCreateGoal, useSessionGoal, useUpdateGoal } from "@/app/services/queries";
import type { GoalStatus, SessionGoalRecord } from "@/app/types/api";

function budgetValue(goal: SessionGoalRecord | null): string {
  return goal?.token_budget == null ? "" : String(goal.token_budget);
}

/**
 * Blank is no limit; anything else must be a whole number the field can send
 * exactly (undefined when it is not). The server owns which amounts it allows.
 */
function parsedBudget(value: string): number | null | undefined {
  if (!value.trim()) return null;
  return parseGoalBudget(value) ?? undefined;
}

const STATUS_TONE: Partial<Record<GoalStatus, string>> = {
  active: "bg-[var(--f-wash-2)] text-basic-primary",
  paused: "bg-[var(--f-wash-2)] text-basic-tertiary",
  complete: "bg-[var(--f-green-wash)] text-[var(--f-green-text)]",
};

/**
 * The goal drawer: the durable objective a direct agent keeps working
 * toward, how much of its budget it has used, and the same pause, resume,
 * edit and clear the composer's `/goal` commands reach, through the same
 * versioned mutations.
 */
export function GoalPanel({ sessionId, enabled }: { sessionId: string; enabled: boolean }) {
  const goalQuery = useSessionGoal(sessionId, enabled);
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const clearGoal = useClearGoal();
  const toast = useToast();
  const goal = goalQuery.data ?? null;
  const [editing, setEditing] = useState(false);
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  /** The goal this edit started from: a stale edit is refused, not overwritten. */
  const [base, setBase] = useState<SessionGoalRecord | null>(null);
  const busy = createGoal.isPending || updateGoal.isPending || clearGoal.isPending;

  const fail = (prefix: string, error: unknown) =>
    toast.error(`${prefix}: ${errorMessage(toRunError(error))}`);

  const edit = () => {
    setBase(goal);
    setObjective(goal?.objective ?? "");
    setBudget(budgetValue(goal));
    setEditing(true);
  };

  const save = async () => {
    const replacing = goal == null || goal.status === "complete";
    // An update leaves a budget the user has not touched alone, so a stored
    // amount the field cannot send exactly survives an objective-only edit.
    const budgetEdited = replacing || base == null || budget !== budgetValue(base);
    const tokenBudget = budgetEdited ? parsedBudget(budget) : null;
    if (!objective.trim()) {
      toast.error("Goal objective is required.");
      return;
    }
    if (tokenBudget === undefined) {
      toast.error(`Enter the token budget as ${GOAL_BUDGET_INPUT_RULE}, or leave it blank.`);
      return;
    }
    // Run accounting bumps the version on its own, so the current version is
    // used only while the objective and budget are still what the edit
    // started from; otherwise the loaded version lets the server refuse it.
    const target = goal == null || base == null || sameGoalEditableFields(goal, base) ? goal : base;
    try {
      if (!replacing && target != null) {
        await updateGoal.mutateAsync({
          sessionId,
          goalId: target.goal_id,
          payload: {
            expected_version: target.version,
            objective: objective.trim(),
            ...(budgetEdited ? { token_budget: tokenBudget } : {}),
          },
        });
      } else {
        await createGoal.mutateAsync({
          sessionId,
          payload: {
            objective: objective.trim(),
            ...(tokenBudget === null ? {} : { token_budget: tokenBudget }),
          },
        });
      }
      setEditing(false);
    } catch (error) {
      fail(replacing ? "Unable to create goal" : "Unable to update goal", error);
    }
  };

  const setStatus = async (status: GoalStatus) => {
    if (!goal) return;
    try {
      await updateGoal.mutateAsync({
        sessionId,
        goalId: goal.goal_id,
        payload: { expected_version: goal.version, status },
      });
    } catch (error) {
      fail("Unable to change goal status", error);
    }
  };

  const clear = async () => {
    if (!goal) return;
    try {
      await clearGoal.mutateAsync({
        sessionId,
        goalId: goal.goal_id,
        expectedVersion: goal.version,
      });
      setEditing(false);
    } catch (error) {
      fail("Unable to clear goal", error);
    }
  };

  if (goalQuery.isPending && enabled) {
    return <p className="type-body-chrome p-5 text-basic-tertiary">Loading goal…</p>;
  }
  if (goalQuery.isError) {
    return (
      <p role="alert" className="type-body-chrome p-5 text-error-primary">
        The goal could not be loaded.
      </p>
    );
  }

  if (editing || !goal) {
    return (
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {goal ? null : (
          <p className="type-body-chrome text-basic-tertiary">
            No goal is set. A goal keeps the agent working across ordinary turns until it is
            complete, blocked, paused or out of budget.
          </p>
        )}
        <TextArea
          label="Objective"
          // The atom's caption is not tied to its field, so name the field itself.
          aria-label="Objective"
          textAreaSize={TextAreaSize.Medium}
          placeholder="Describe the concrete outcome"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          textAreaClassName="h-[120px] resize-none"
        />
        <Input
          label="Token budget (optional)"
          inputSize={InputSize.Medium}
          inputMode="numeric"
          placeholder="No limit"
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
        />
        <div className="flex justify-end gap-2">
          {goal ? (
            <Button
              variant={ButtonVariant.Ghost}
              size={ButtonSize.Medium}
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          ) : null}
          <Button
            type="submit"
            variant={ButtonVariant.Primary}
            size={ButtonSize.Medium}
            loading={busy}
          >
            {goal && goal.status !== "complete" ? "Save goal" : "Set goal"}
          </Button>
        </div>
      </form>
    );
  }

  const remaining =
    goal.token_budget == null ? null : Math.max(0, goal.token_budget - goal.tokens_used);
  const share =
    goal.token_budget == null || goal.token_budget === 0
      ? null
      : Math.min(1, goal.tokens_used / goal.token_budget);

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-3">
        <span
          className={cn(
            "type-meta-strong w-fit rounded-pill px-2 py-0.5",
            STATUS_TONE[goal.status] ?? "bg-[var(--f-amber-wash)] text-[var(--f-amber-text)]",
          )}
        >
          {goalStatusLabel(goal.status).replace(/^./, (first) => first.toUpperCase())}
        </span>
        <p className="type-body whitespace-pre-wrap text-basic-primary [overflow-wrap:anywhere]">
          {goal.objective}
        </p>
      </div>

      <dl className="type-meta grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
        <dt className="text-basic-tertiary">Tokens used</dt>
        <dd className="tabular text-right text-basic-primary">
          {formatTokensCompact(goal.tokens_used)}
          {goal.token_budget == null ? null : (
            <span className="text-basic-tertiary"> / {formatTokensCompact(goal.token_budget)}</span>
          )}
        </dd>
        {remaining == null ? null : (
          <>
            <dt className="text-basic-tertiary">Remaining</dt>
            <dd className="tabular text-right text-basic-primary">
              {formatTokensCompact(remaining)}
            </dd>
          </>
        )}
        <dt className="text-basic-tertiary">Time worked</dt>
        <dd className="tabular text-right text-basic-primary">{formatClock(goal.time_used_ms)}</dd>
      </dl>
      {share == null ? null : (
        <div
          role="meter"
          aria-label="Token budget used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          className="h-1 overflow-hidden rounded-pill bg-[var(--f-wash-2)]"
        >
          <div
            className={cn(
              "h-full rounded-pill transition-[width] duration-200 ease-out",
              share >= 0.8 ? "bg-[var(--f-amber)]" : "bg-[var(--f-ink-3)]",
            )}
            style={{ width: `${share * 100}%` }}
          />
        </div>
      )}

      {goal.last_failure ? (
        <p className="type-meta rounded-md bg-[var(--f-red-wash)] px-3 py-2 text-[var(--f-red-text)]">
          {goal.last_failure.diagnostic}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {goal.status === "active" ? (
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Medium}
            disabled={busy}
            onClick={() => void setStatus("paused")}
          >
            Pause
          </Button>
        ) : goal.status === "complete" ? null : (
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Medium}
            disabled={busy}
            onClick={() => void setStatus("active")}
          >
            Resume
          </Button>
        )}
        <Button
          variant={ButtonVariant.Secondary}
          size={ButtonSize.Medium}
          disabled={busy}
          onClick={edit}
        >
          {goal.status === "complete" ? "New goal" : "Edit"}
        </Button>
        <Button
          variant={ButtonVariant.GhostDestructive}
          size={ButtonSize.Medium}
          disabled={busy}
          onClick={() => void clear()}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
