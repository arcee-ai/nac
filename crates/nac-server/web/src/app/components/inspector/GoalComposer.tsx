import { useEffect, useRef, useState } from "react";

import {
  Badge,
  BadgeColor,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  RangeInput,
  Switch,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useClearGoal, useCreateGoal, useSessionGoal, useUpdateGoal } from "@/app/services/queries";
import type { GoalStatus, SessionGoalRecord } from "@/app/types/api";

const GOAL_HINT =
  "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.";

const BUDGET_MIN = 100;
const BUDGET_MAX = 1_000_000;
const BUDGET_STEP = 100;
const BUDGET_DEFAULT = 9_600;

function statusLabel(status: GoalStatus): string {
  const label = status.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function badgeColor(status: GoalStatus): BadgeColor {
  if (status === "active") return BadgeColor.Green;
  if (status === "complete") return BadgeColor.Gray;
  return BadgeColor.Yellow;
}

function clampBudget(value: number): number {
  const snapped = Math.round(value / BUDGET_STEP) * BUDGET_STEP;
  return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, snapped));
}

interface GoalFlagProps {
  sessionId: string;
  className?: string;
  onOpen: () => void;
}

/** Flag inside the message field. Opens the inline goal editor. */
export function GoalFlag({ sessionId, className, onOpen }: GoalFlagProps) {
  const goalQuery = useSessionGoal(sessionId, true);
  const goal = goalQuery.data ?? null;
  const active = goal?.status === "active";

  return (
    <Tooltip
      className={className}
      position={TooltipPosition.TopCenter}
      title={
        goal ? `Current Goal: ${statusLabel(goal.status)} - Click To Edit` : "Set Durable Goal"
      }
      description={goal ? goal.objective : GOAL_HINT}
    >
      <Button
        type="button"
        size={ButtonSize.Large}
        variant={active ? ButtonVariant.GhostHighlightedAccent : ButtonVariant.Ghost}
        content={ButtonContent.Icon}
        aria-label={goal ? `Edit goal: ${statusLabel(goal.status)}` : "Set durable goal"}
        onClick={onOpen}
      >
        <Icon iconName={IconName.Flag} size={24} />
      </Button>
    </Tooltip>
  );
}

interface GoalEditorProps {
  sessionId: string;
  onClose: () => void;
}

/**
 * Inline durable-goal editor that replaces the message field. The token budget
 * switch off means no limit; on means the slider value.
 */
export function GoalEditor({ sessionId, onClose }: GoalEditorProps) {
  const goalQuery = useSessionGoal(sessionId, true);
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const clearGoal = useClearGoal();
  const toast = useToast();
  const goal = goalQuery.data ?? null;
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [budgetOn, setBudgetOn] = useState(goal?.token_budget != null);
  const [budgetAmount, setBudgetAmount] = useState(
    clampBudget(goal?.token_budget ?? BUDGET_DEFAULT),
  );
  const seeded = useRef(goalQuery.data !== undefined);

  useEffect(() => {
    if (seeded.current || goalQuery.isPending) return;
    seeded.current = true;
    const loaded = goalQuery.data ?? null;
    setObjective(loaded?.objective ?? "");
    setBudgetOn(loaded?.token_budget != null);
    setBudgetAmount(clampBudget(loaded?.token_budget ?? BUDGET_DEFAULT));
  }, [goalQuery.data, goalQuery.isPending]);

  const busy = createGoal.isPending || updateGoal.isPending || clearGoal.isPending;
  const editingExisting = goal != null && goal.status !== "complete";
  const fail = (prefix: string, error: unknown) => {
    toast.error(`${prefix}: ${errorMessage(toRunError(error))}`);
  };

  const save = async (closeAfter: boolean) => {
    const tokenBudget = budgetOn ? budgetAmount : null;
    if (!objective.trim()) {
      toast.error("Goal objective is required.");
      return;
    }
    try {
      if (editingExisting && goal) {
        await updateGoal.mutateAsync({
          sessionId,
          goalId: goal.goal_id,
          payload: {
            expected_version: goal.version,
            objective: objective.trim(),
            token_budget: tokenBudget,
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
      if (closeAfter) onClose();
    } catch (error) {
      fail(editingExisting ? "Unable to update goal" : "Unable to create goal", error);
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
      setObjective("");
      setBudgetOn(false);
      setBudgetAmount(BUDGET_DEFAULT);
    } catch (error) {
      fail("Unable to clear goal", error);
    }
  };

  const corner = cornerAction(goal, busy || !objective.trim());

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-[8px] bg-input p-2">
        {goalQuery.isPending ? (
          <div className="text-micro text-basic-secondary">Loading goal…</div>
        ) : goalQuery.isError ? (
          <div className="rounded-[4px] bg-error-secondary p-2 text-micro text-error-primary">
            Goal state could not be loaded.
          </div>
        ) : goal ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="shrink-0 text-micro font-semibold text-basic-primary">
              Current Goal
            </span>
            <Badge text={statusLabel(goal.status)} color={badgeColor(goal.status)} />
            <span className="min-w-0 flex-1 truncate text-micro text-basic-secondary">
              {goal.tokens_used.toLocaleString()} Tokens, {Math.floor(goal.time_used_ms / 1000)}s
            </span>
            <Button
              type="button"
              size={ButtonSize.Small}
              variant={ButtonVariant.GhostDestructive}
              disabled={busy}
              onClick={() => void clear()}
            >
              Clear
            </Button>
            <Button
              type="button"
              size={ButtonSize.Small}
              variant={ButtonVariant.Primary}
              loading={busy}
              disabled={!objective.trim()}
              onClick={() => void save(!editingExisting)}
            >
              {goal.status === "complete" ? "Replace" : "Save"}
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Switch
            checked={budgetOn}
            disabled={busy}
            aria-label="Token budget"
            onChange={setBudgetOn}
          />
          <span className="label-micro shrink-0 text-basic-primary">Token Budget</span>
          {budgetOn ? null : (
            <span className="w-16 shrink-0 text-micro text-basic-muted">Disabled</span>
          )}
          <span className="code code-small w-[60px] shrink-0 text-right text-basic-secondary">
            {budgetAmount.toLocaleString()}
          </span>
          <RangeInput
            className="min-w-0 flex-1"
            min={BUDGET_MIN}
            max={BUDGET_MAX}
            step={BUDGET_STEP}
            value={budgetAmount}
            disabled={busy}
            label="Token budget"
            onChange={(value) => {
              setBudgetAmount(value);
              setBudgetOn(true);
            }}
          />
        </div>
      </div>
      <div className="relative flex items-end rounded-[4px] bg-btn-secondary-accent pr-[96px]">
        <textarea
          className="relative block min-h-[48px] w-full resize-none border-none bg-transparent p-3 text-medium text-input outline-none placeholder:text-input-placeholder"
          rows={objective.length > 80 ? 3 : 1}
          aria-label="Goal objective"
          placeholder="Describe the concrete output"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            void save(goal == null || goal.status === "complete");
          }}
        />
        <Button
          type="button"
          className="absolute right-[48px] bottom-0"
          size={ButtonSize.Large}
          variant={ButtonVariant.Ghost}
          content={ButtonContent.Icon}
          aria-label="Close goal editor"
          onClick={onClose}
        >
          <Icon iconName={IconName.Close} size={24} />
        </Button>
        <Button
          type="button"
          className="absolute right-0 bottom-0"
          size={ButtonSize.Large}
          variant={ButtonVariant.Primary}
          content={ButtonContent.Icon}
          disabled={corner.disabled || busy}
          loading={busy && corner.kind === "save"}
          aria-label={corner.label}
          onClick={() => {
            if (corner.kind === "pause") void setStatus("paused");
            else if (corner.kind === "resume") void setStatus("active");
            else void save(true);
          }}
        >
          <Icon iconName={corner.icon} />
        </Button>
      </div>
    </div>
  );
}

function cornerAction(
  goal: SessionGoalRecord | null,
  saveDisabled: boolean,
): { kind: "save" | "pause" | "resume"; label: string; icon: IconName; disabled: boolean } {
  if (goal?.status === "active") {
    return { kind: "pause", label: "Pause goal", icon: IconName.Stop, disabled: false };
  }
  if (goal && goal.status !== "complete") {
    return { kind: "resume", label: "Resume goal", icon: IconName.Play, disabled: false };
  }
  return {
    kind: "save",
    label: goal?.status === "complete" ? "Replace goal" : "Create goal",
    icon: IconName.Plane,
    disabled: saveDisabled,
  };
}
