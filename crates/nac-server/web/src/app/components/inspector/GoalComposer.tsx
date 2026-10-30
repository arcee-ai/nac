import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  Badge,
  Button,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  RangeInput,
  Switch,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import {
  ComposerIconButton,
  ComposerPill,
  ComposerSendButton,
} from "@/app/components/inspector/composer/ComposerFrame";
import {
  goalBadgeColor as badgeColor,
  goalStatusLabel as statusLabel,
} from "@/app/features/goals/status";
import { cn } from "@/app/lib/cn";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useClearGoal, useCreateGoal, useSessionGoal, useUpdateGoal } from "@/app/services/queries";
import type { GoalStatus, SessionGoalRecord } from "@/app/types/api";

const GOAL_HINT =
  "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.";

/** The slider's range is a convenience; the number field takes any amount. */
const BUDGET_MIN = 100;
const BUDGET_MAX = 1_000_000;
const BUDGET_STEP = 100;
const BUDGET_DEFAULT = 9_600;

const BUDGET_EXPLANATION =
  "The total billable tokens all of this goal's runs may use, cached reads and writes included. When usage reaches it, the goal stops as budget limited. It is not the model's context size and not a cost guarantee.";

/** How far the objective grows before it scrolls, as the message field does. */
const MAX_HEIGHT_PX = 180;

/** Where the slider's knob sits for an amount, which may lie outside its range. */
function sliderPosition(value: number): number {
  return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, value));
}

/**
 * A typed amount as a whole number of tokens, or null when it is not one. The
 * server owns which amounts are allowed and says so when it refuses one.
 */
function parseBudget(text: string): number | null {
  const digits = text.replace(/[\s,_]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** Whether a stored goal still holds the fields an edit was started from. */
function sameEditableFields(left: SessionGoalRecord, right: SessionGoalRecord): boolean {
  return (
    left.goal_id === right.goal_id &&
    left.objective === right.objective &&
    left.token_budget === right.token_budget
  );
}

interface GoalFlagProps {
  sessionId: string;
  compact: boolean;
  className?: string;
  onOpen: () => void;
}

/** Flag at the end of the message pill. Opens the inline goal editor. */
export function GoalFlag({ sessionId, compact, className, onOpen }: GoalFlagProps) {
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
      <ComposerIconButton
        compact={compact}
        type="button"
        variant={active ? ButtonVariant.GhostHighlightedAccent : ButtonVariant.Ghost}
        aria-label={goal ? `Edit goal: ${statusLabel(goal.status)}` : "Set durable goal"}
        onClick={onOpen}
      >
        <Icon iconName={IconName.Flag} size={24} />
      </ComposerIconButton>
    </Tooltip>
  );
}

interface GoalEditorProps {
  sessionId: string;
  compact: boolean;
  onClose: () => void;
}

/**
 * Inline durable-goal editor that stands in for the message field: the goal
 * card above, the objective in the pill. The token budget switch off means no
 * limit and hides the amount; on means the typed amount, which the slider can
 * also set up to its convenience maximum. An update leaves the budget alone
 * until the user changes it, so a stored figure the slider cannot hold
 * survives an objective edit. Edits are versioned against the goal the editor
 * loaded: if its objective or budget changed elsewhere, the server rejects the
 * stale edit instead of overwriting it.
 */
export function GoalEditor({ sessionId, compact, onClose }: GoalEditorProps) {
  const goalQuery = useSessionGoal(sessionId, true);
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const clearGoal = useClearGoal();
  const toast = useToast();
  const goal = goalQuery.data ?? null;
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [budgetOn, setBudgetOn] = useState(goal?.token_budget != null);
  const [budgetText, setBudgetText] = useState(String(goal?.token_budget ?? BUDGET_DEFAULT));
  const budgetEdited = useRef(false);
  const objectiveEdited = useRef(false);
  /** The goal this edit started from, null when the editor opened empty. */
  const loaded = useRef<SessionGoalRecord | null>(goal);
  const seeded = useRef(goalQuery.data !== undefined);
  const budgetAmount = parseBudget(budgetText);
  const budgetInvalid = budgetOn && budgetAmount === null;

  useEffect(() => {
    if (seeded.current || goalQuery.isPending) return;
    seeded.current = true;
    const current = goalQuery.data ?? null;
    loaded.current = current;
    // Whatever the user typed while the goal loaded stays; the rest is seeded.
    if (!objectiveEdited.current) setObjective(current?.objective ?? "");
    if (!budgetEdited.current) {
      setBudgetOn(current?.token_budget != null);
      setBudgetText(String(current?.token_budget ?? BUDGET_DEFAULT));
    }
  }, [goalQuery.data, goalQuery.isPending]);

  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [objective]);

  const busy = createGoal.isPending || updateGoal.isPending || clearGoal.isPending;
  const editingExisting = goal != null && goal.status !== "complete";
  const fail = (prefix: string, error: unknown) => {
    toast.error(`${prefix}: ${errorMessage(toRunError(error))}`);
  };

  const save = async (closeAfter: boolean) => {
    if (!objective.trim()) {
      toast.error("Goal objective is required.");
      return;
    }
    if (budgetInvalid) {
      toast.error("Enter the token budget as a whole number of tokens.");
      return;
    }
    const tokenBudget = budgetOn ? budgetAmount : null;
    // Edit the goal the editor loaded. Run accounting bumps the version on its
    // own, so the current version is used only while the objective and budget
    // are still what the editor loaded; otherwise the loaded version lets the
    // server's version check refuse the stale overwrite.
    const base = loaded.current;
    const target =
      base == null ? null : goal != null && sameEditableFields(goal, base) ? goal : base;
    try {
      let saved: SessionGoalRecord;
      if (target != null && editingExisting) {
        saved = await updateGoal.mutateAsync({
          sessionId,
          goalId: target.goal_id,
          payload: {
            expected_version: target.version,
            objective: objective.trim(),
            ...(budgetEdited.current ? { token_budget: tokenBudget } : {}),
          },
        });
      } else {
        saved = await createGoal.mutateAsync({
          sessionId,
          payload: {
            objective: objective.trim(),
            ...(tokenBudget === null ? {} : { token_budget: tokenBudget }),
          },
        });
      }
      loaded.current = saved;
      budgetEdited.current = false;
      objectiveEdited.current = false;
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
      loaded.current = null;
      setObjective("");
      setBudgetOn(false);
      setBudgetText(String(BUDGET_DEFAULT));
      budgetEdited.current = false;
      objectiveEdited.current = false;
    } catch (error) {
      fail("Unable to clear goal", error);
    }
  };

  const corner = cornerAction(goal, busy || !objective.trim() || budgetInvalid);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-[20px] bg-elevation-level-2 p-3 shadow-md">
        {goalQuery.isPending ? (
          <div className="text-micro text-basic-secondary">Loading goal…</div>
        ) : goalQuery.isError ? (
          <div className="rounded-[4px] bg-error-secondary p-2 text-micro text-error-primary">
            Goal state could not be loaded.
          </div>
        ) : goal ? (
          <div className="flex min-h-6 flex-wrap items-center gap-2">
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
        <div className="flex flex-col gap-2">
          <div className="flex min-h-6 items-center gap-2">
            <Switch
              checked={budgetOn}
              disabled={busy}
              aria-label="Token budget"
              onChange={(checked) => {
                budgetEdited.current = true;
                setBudgetOn(checked);
              }}
            />
            <span className="label-micro shrink-0 text-basic-primary">Token Budget</span>
            {budgetOn ? null : (
              <span className="label-micro shrink-0 text-basic-muted">No token limit</span>
            )}
          </div>
          {budgetOn ? (
            <>
              <p className="text-micro text-basic-secondary">{BUDGET_EXPLANATION}</p>
              <div className="flex items-center gap-3">
                <Input
                  className="w-[132px] shrink-0"
                  inputSize={InputSize.Small}
                  inputMode="numeric"
                  aria-label="Token budget amount"
                  aria-invalid={budgetInvalid}
                  validation={budgetInvalid}
                  isDisabled={busy}
                  value={budgetText}
                  onChange={(event) => {
                    budgetEdited.current = true;
                    setBudgetText(event.target.value);
                  }}
                />
                <RangeInput
                  className="min-w-0 flex-1"
                  smallKnob
                  min={BUDGET_MIN}
                  max={BUDGET_MAX}
                  step={BUDGET_STEP}
                  value={sliderPosition(budgetAmount ?? BUDGET_MIN)}
                  disabled={busy}
                  label="Token budget slider"
                  onChange={(value) => {
                    budgetEdited.current = true;
                    setBudgetText(String(value));
                  }}
                />
              </div>
              <span
                role={budgetInvalid ? "alert" : undefined}
                className={cn(
                  "text-micro",
                  budgetInvalid ? "text-error-primary" : "text-basic-muted",
                )}
              >
                {budgetInvalid
                  ? "Enter a whole number of tokens."
                  : budgetAmount !== null && budgetAmount > BUDGET_MAX
                    ? `${budgetAmount.toLocaleString()} tokens, above the slider's range and kept as entered.`
                    : `${(budgetAmount ?? 0).toLocaleString()} tokens.`}
              </span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-end gap-2">
        <ComposerPill compact={compact} outline="accent">
          <textarea
            ref={field}
            className={cn(
              "block min-w-0 flex-1 resize-none border-none bg-transparent text-medium text-input outline-none placeholder:text-input-placeholder",
              compact ? "px-3 py-2" : "px-4 py-3",
            )}
            rows={1}
            aria-label="Goal objective"
            placeholder="Describe the concrete output"
            value={objective}
            onChange={(event) => {
              objectiveEdited.current = true;
              setObjective(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key !== "Enter" || event.shiftKey) return;
              // A phone keyboard has no Shift+Enter, so Return starts a new line there.
              if (compact && !event.metaKey && !event.ctrlKey) return;
              event.preventDefault();
              void save(goal == null || goal.status === "complete");
            }}
          />
          <ComposerIconButton
            compact={compact}
            type="button"
            variant={ButtonVariant.GhostAccent}
            aria-label="Close goal editor"
            onClick={onClose}
          >
            <Icon iconName={IconName.Close} size={24} />
          </ComposerIconButton>
        </ComposerPill>
        <ComposerSendButton
          compact={compact}
          type="button"
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
        </ComposerSendButton>
      </div>
    </div>
  );
}

function cornerAction(
  goal: SessionGoalRecord | null,
  saveDisabled: boolean,
): { kind: "save" | "pause" | "resume"; label: string; icon: IconName; disabled: boolean } {
  if (goal?.status === "active") {
    return { kind: "pause", label: "Pause goal", icon: IconName.Pause, disabled: false };
  }
  if (goal && goal.status !== "complete") {
    return { kind: "resume", label: "Resume goal", icon: IconName.Play, disabled: false };
  }
  return {
    kind: "save",
    label: goal?.status === "complete" ? "Replace goal" : "Create goal",
    icon: IconName.ArrowTop,
    disabled: saveDisabled,
  };
}
