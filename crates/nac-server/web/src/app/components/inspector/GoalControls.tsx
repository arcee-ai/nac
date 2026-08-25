import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Modal,
  ModalSize,
  TextArea,
  TextAreaSize,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { toRunError } from "@/app/lib/providerError";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { useClearGoal, useCreateGoal, useSessionGoal, useUpdateGoal } from "@/app/services/queries";
import type { GoalStatus, SessionBehavior, SessionGoalRecord } from "@/app/types/api";

interface GoalControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
}

function statusLabel(status: GoalStatus): string {
  return status.replaceAll("_", " ");
}

function budgetValue(goal: SessionGoalRecord | null): string {
  return goal?.token_budget === null || goal?.token_budget === undefined
    ? ""
    : String(goal.token_budget);
}

function parsedBudget(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Direct-only durable goal state and user controls. */
export function GoalControls({ sessionId, behavior }: GoalControlsProps) {
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const goalQuery = useSessionGoal(sessionId, direct);
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const clearGoal = useClearGoal();
  const toast = useToast();
  const goal = goalQuery.data ?? null;
  const [open, setOpen] = useState(false);
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");

  if (!direct) return null;

  const busy = createGoal.isPending || updateGoal.isPending || clearGoal.isPending;
  const show = () => {
    setObjective(goal?.objective ?? "");
    setBudget(budgetValue(goal));
    setOpen(true);
  };
  const fail = (prefix: string, error: unknown) => {
    toast.error(`${prefix}: ${errorMessage(toRunError(error))}`);
  };
  const save = async () => {
    const tokenBudget = parsedBudget(budget);
    if (!objective.trim()) {
      toast.error("Goal objective is required.");
      return;
    }
    if (tokenBudget === undefined) {
      toast.error("Token budget must be a positive whole number or blank.");
      return;
    }
    try {
      if (goal) {
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
    } catch (error) {
      fail(goal ? "Unable to update goal" : "Unable to create goal", error);
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
      setBudget("");
    } catch (error) {
      fail("Unable to clear goal", error);
    }
  };

  return (
    <>
      <Tooltip title="Durable goal" position={TooltipPosition.TopCenter}>
        <Button
          size={ButtonSize.Small}
          variant={
            goal?.status === "active" ? ButtonVariant.GhostHighlightedAccent : ButtonVariant.Ghost
          }
          content={ButtonContent.Icon}
          aria-label={goal ? `Goal: ${statusLabel(goal.status)}` : "Create durable goal"}
          onClick={show}
        >
          <Icon iconName={IconName.Flag} size={16} />
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size={ModalSize.Wide}
        title={goal ? "Durable goal" : "Create durable goal"}
        subheader="Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited."
      >
        {goalQuery.isPending ? (
          <div className="py-6 text-center text-small text-basic-secondary">Loading goal…</div>
        ) : goalQuery.isError ? (
          <div className="rounded-[4px] bg-error-secondary p-3 text-small text-error-primary">
            Goal state could not be loaded.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {goal ? (
              <div className="rounded-[4px] bg-elevation-level-2 px-3 py-2 text-small">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tag-label uppercase text-basic-secondary">
                    {statusLabel(goal.status)}
                  </span>
                  <span className="text-basic-tertiary">
                    {goal.tokens_used.toLocaleString()} tokens ·{" "}
                    {Math.floor(goal.time_used_ms / 1000)}s
                  </span>
                </div>
                {goal.token_budget === null ? null : (
                  <div className="mt-1 text-basic-tertiary">
                    {Math.max(0, goal.token_budget - goal.tokens_used).toLocaleString()} tokens
                    remaining
                  </div>
                )}
              </div>
            ) : null}

            <TextArea
              label="Objective"
              textAreaSize={TextAreaSize.Medium}
              placeholder="Describe the concrete outcome"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              textAreaClassName="h-[112px] resize-none"
            />
            <Input
              label="Token budget (optional)"
              inputSize={InputSize.Medium}
              inputMode="numeric"
              placeholder="No limit"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />

            <div className="flex flex-wrap justify-end gap-2">
              {goal ? (
                <>
                  {goal.status === "active" ? (
                    <>
                      <Button
                        variant={ButtonVariant.Secondary}
                        disabled={busy}
                        onClick={() => void setStatus("paused")}
                      >
                        Pause
                      </Button>
                      <Button
                        variant={ButtonVariant.Secondary}
                        disabled={busy}
                        onClick={() => void setStatus("usage_limited")}
                      >
                        Usage limit
                      </Button>
                      <Button
                        variant={ButtonVariant.Secondary}
                        disabled={busy}
                        onClick={() => void setStatus("budget_limited")}
                      >
                        Budget limit
                      </Button>
                    </>
                  ) : goal.status === "complete" ? null : (
                    <Button
                      variant={ButtonVariant.Secondary}
                      disabled={busy}
                      onClick={() => void setStatus("active")}
                    >
                      Resume
                    </Button>
                  )}
                  <Button
                    variant={ButtonVariant.GhostDestructive}
                    disabled={busy}
                    onClick={() => void clear()}
                  >
                    Clear
                  </Button>
                </>
              ) : null}
              <Button variant={ButtonVariant.Primary} loading={busy} onClick={() => void save()}>
                {goal ? "Save" : "Create and start"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
