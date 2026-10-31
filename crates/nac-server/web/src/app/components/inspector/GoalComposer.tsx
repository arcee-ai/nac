import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  Badge,
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Input,
  InputSize,
  Modal,
  RangeInput,
  StickyButton,
  Switch,
  SwitchSize,
  TextArea,
  TextAreaSize,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import {
  ComposerIconButton,
  ComposerInlineButton,
  ComposerInlineSlot,
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
  "Direct-session work that continues across ordinary turns until completed, blocked, paused or limited.";
const OBJECTIVE_PLACEHOLDER = "Describe the concrete output";

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

/** What the amount field accepts: larger values cannot be sent exactly. */
const BUDGET_INPUT_RULE = `a whole number of tokens up to ${Number.MAX_SAFE_INTEGER.toLocaleString("en-US")}`;

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

function usageLabel(goal: SessionGoalRecord): string {
  return `${goal.tokens_used.toLocaleString()} Tokens, ${Math.floor(goal.time_used_ms / 1000)}s`;
}

/**
 * The objective and token budget being written, seeded from the stored goal
 * each time an editor opens on it. The budget switch off means no limit and
 * hides the amount; on means the typed amount, which the slider can also set
 * up to its convenience maximum. An update leaves the budget alone until the
 * user changes it, so a stored figure the slider cannot hold survives an
 * objective edit. Edits are versioned against the goal the editor loaded: if
 * its objective or budget changed elsewhere, the server rejects the stale edit
 * instead of overwriting it.
 */
function useGoalDraft(sessionId: string, open: boolean) {
  const goalQuery = useSessionGoal(sessionId, open);
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const clearGoal = useClearGoal();
  const toast = useToast();
  const goal = goalQuery.data ?? null;
  const [objective, setObjective] = useState("");
  const [budgetOn, setBudgetOn] = useState(false);
  const [budgetText, setBudgetText] = useState(String(BUDGET_DEFAULT));
  const [budgetEdited, setBudgetEdited] = useState(false);
  const [objectiveEdited, setObjectiveEdited] = useState(false);
  /** The goal this edit started from, null when the editor opened empty. */
  const [base, setBase] = useState<SessionGoalRecord | null>(null);
  const [seeded, setSeeded] = useState(false);

  // During render, so an editor never paints the draft it was last closed on.
  // Whatever the user typed while the goal loaded stays; the rest is seeded.
  const loaded = open && !goalQuery.isPending;
  if (seeded !== loaded) {
    setSeeded(loaded);
    if (loaded) {
      setBase(goal);
      if (!objectiveEdited) setObjective(goal?.objective ?? "");
      if (!budgetEdited) {
        setBudgetOn(goal?.token_budget != null);
        setBudgetText(String(goal?.token_budget ?? BUDGET_DEFAULT));
      }
    } else {
      setObjectiveEdited(false);
      setBudgetEdited(false);
    }
  }

  const budgetAmount = parseBudget(budgetText);
  const budgetInvalid = budgetOn && budgetAmount === null;

  const busy = createGoal.isPending || updateGoal.isPending || clearGoal.isPending;
  const editingExisting = goal != null && goal.status !== "complete";
  const trimmed = objective.trim();
  const tokenBudget = budgetOn ? budgetAmount : null;
  const changed =
    goal == null ||
    goal.status === "complete" ||
    trimmed !== goal.objective ||
    (budgetEdited && tokenBudget !== goal.token_budget);

  const fail = (prefix: string, error: unknown) => {
    toast.error(`${prefix}: ${errorMessage(toRunError(error))}`);
  };

  /** Creates the goal, or writes the edit to it. Resolves whether it landed. */
  const save = async (): Promise<boolean> => {
    if (!trimmed) {
      toast.error("Goal objective is required.");
      return false;
    }
    if (budgetInvalid) {
      toast.error(`Enter the token budget as ${BUDGET_INPUT_RULE}.`);
      return false;
    }
    // Edit the goal the editor loaded. Run accounting bumps the version on its
    // own, so the current version is used only while the objective and budget
    // are still what the editor loaded; otherwise the loaded version lets the
    // server's version check refuse the stale overwrite.
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
            objective: trimmed,
            ...(budgetEdited ? { token_budget: tokenBudget } : {}),
          },
        });
      } else {
        saved = await createGoal.mutateAsync({
          sessionId,
          payload: {
            objective: trimmed,
            ...(tokenBudget === null ? {} : { token_budget: tokenBudget }),
          },
        });
      }
      setBase(saved);
      setBudgetEdited(false);
      setObjectiveEdited(false);
      return true;
    } catch (error) {
      fail(editingExisting ? "Unable to update goal" : "Unable to create goal", error);
      return false;
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
      setBase(null);
      setObjective("");
      setBudgetOn(false);
      setBudgetText(String(BUDGET_DEFAULT));
      setBudgetEdited(false);
      setObjectiveEdited(false);
    } catch (error) {
      fail("Unable to clear goal", error);
    }
  };

  return {
    goalQuery,
    goal,
    objective,
    setObjective: (value: string) => {
      setObjectiveEdited(true);
      setObjective(value);
    },
    budgetOn,
    budgetText,
    budgetAmount,
    budgetInvalid,
    busy,
    editingExisting,
    changed,
    save,
    setStatus,
    clear,
    toggleBudget: (checked: boolean) => {
      setBudgetEdited(true);
      setBudgetOn(checked);
    },
    typeBudget: (text: string) => {
      setBudgetEdited(true);
      setBudgetText(text);
    },
    slideBudget: (value: number) => {
      setBudgetEdited(true);
      setBudgetText(String(value));
    },
  };
}

type GoalDraft = ReturnType<typeof useGoalDraft>;

interface GoalComposerProps {
  sessionId: string;
  open: boolean;
  mobile: boolean;
  onClose: () => void;
}

/** One edit lifetime across the inline and phone presentations. */
export function GoalComposer({ sessionId, open, mobile, onClose }: GoalComposerProps) {
  const draft = useGoalDraft(sessionId, open);
  return (
    <>
      {open && !mobile ? <GoalEditor draft={draft} onClose={onClose} /> : null}
      <GoalMobileModal draft={draft} open={open && mobile} onClose={onClose} />
    </>
  );
}

interface GoalFlagProps {
  sessionId: string;
  compact: boolean;
  onOpen: () => void;
}

/** Flag beside Send while the field rests. Opens the goal editor. */
export function GoalFlag({ sessionId, compact, onOpen }: GoalFlagProps) {
  const goalQuery = useSessionGoal(sessionId, true);
  const goal = goalQuery.data ?? null;
  const active = goal?.status === "active";

  return (
    <ComposerInlineSlot compact={compact}>
      <Tooltip
        position={TooltipPosition.TopCenter}
        title={
          goal ? `Current Goal: ${statusLabel(goal.status)} - Click To Edit` : "Set Durable Goal"
        }
        description={goal ? goal.objective : GOAL_HINT}
      >
        <ComposerInlineButton
          type="button"
          variant={active ? ButtonVariant.GhostHighlightedAccent : ButtonVariant.Ghost}
          aria-label={goal ? `Edit goal: ${statusLabel(goal.status)}` : "Set durable goal"}
          onClick={onOpen}
        >
          <Icon iconName={IconName.Flag} size={20} />
        </ComposerInlineButton>
      </Tooltip>
    </ComposerInlineSlot>
  );
}

function BudgetSwitch({ draft }: { draft: GoalDraft }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Switch
        checked={draft.budgetOn}
        disabled={draft.busy}
        aria-label="Token budget"
        onChange={draft.toggleBudget}
      />
      <span className="label-micro shrink-0 text-basic-primary">Token Budget</span>
      {draft.budgetOn ? null : (
        <span className="label-micro shrink-0 text-basic-muted">No token limit</span>
      )}
    </div>
  );
}

/** The typed amount beside the slider, which sets it up to its convenience maximum. */
function BudgetRange({
  draft,
  className,
  large = false,
}: {
  draft: GoalDraft;
  className: string;
  large?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center", className)}>
      <Input
        className={cn("shrink-0", large ? "w-40" : "w-[132px]")}
        inputSize={large ? InputSize.Medium : InputSize.Small}
        inputMode="numeric"
        aria-label="Token budget amount"
        aria-invalid={draft.budgetInvalid}
        validation={draft.budgetInvalid}
        isDisabled={draft.busy}
        value={draft.budgetText}
        onChange={(event) => draft.typeBudget(event.target.value)}
      />
      <RangeInput
        className="min-w-0 flex-1"
        smallKnob={!large}
        min={BUDGET_MIN}
        max={BUDGET_MAX}
        step={BUDGET_STEP}
        value={sliderPosition(draft.budgetAmount ?? BUDGET_MIN)}
        disabled={draft.busy}
        label="Token budget slider"
        onChange={draft.slideBudget}
      />
    </div>
  );
}

/** What an enabled budget counts, and the amount as it will be sent. */
function BudgetNote({ draft, className }: { draft: GoalDraft; className?: string }) {
  const { budgetAmount, budgetInvalid } = draft;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <p className="text-micro text-basic-secondary">{BUDGET_EXPLANATION}</p>
      <span
        role={budgetInvalid ? "alert" : undefined}
        className={cn("text-micro", budgetInvalid ? "text-error-primary" : "text-basic-muted")}
      >
        {budgetInvalid
          ? `Enter ${BUDGET_INPUT_RULE}.`
          : budgetAmount !== null && budgetAmount > BUDGET_MAX
            ? `${budgetAmount.toLocaleString()} tokens, above the slider's range and kept as entered.`
            : `${(budgetAmount ?? 0).toLocaleString()} tokens.`}
      </span>
    </div>
  );
}

interface GoalEditorProps {
  draft: GoalDraft;
  onClose: () => void;
}

/**
 * Desktop durable-goal editor that stands in for the message row while the
 * card wears the goal tone: the goal and its token budget above, the objective
 * where the message was, and the goal's own action where Send was.
 */
function GoalEditor({ draft, onClose }: GoalEditorProps) {
  const { goalQuery, goal, busy } = draft;
  const field = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft.objective]);

  useEffect(() => field.current?.focus(), []);

  const trimmed = draft.objective.trim();
  const corner = cornerAction(goal, busy || !trimmed || draft.budgetInvalid);
  const createAndClose = async () => {
    if (await draft.save()) onClose();
  };
  const closeButton = (
    <ComposerInlineButton
      type="button"
      variant={ButtonVariant.Ghost}
      aria-label="Close goal editor"
      onClick={onClose}
    >
      <Icon iconName={IconName.Close} size={20} />
    </ComposerInlineButton>
  );

  return (
    <>
      {goalQuery.isPending || goalQuery.isError ? (
        <div className="flex items-center gap-4 py-1 pr-1 pl-3">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-micro",
              goalQuery.isError ? "text-error-primary" : "text-basic-secondary",
            )}
          >
            {goalQuery.isError ? "Goal state could not be loaded." : "Loading goal…"}
          </span>
          {closeButton}
        </div>
      ) : goal ? (
        <>
          <div className="flex items-center justify-between gap-4 py-1 pr-1 pl-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="header-sm shrink-0 text-accent-primary">Current Goal</span>
              <span className="min-w-0 truncate text-micro text-accent-tertiary">
                {usageLabel(goal)}
              </span>
              <Badge
                text={statusLabel(goal.status)}
                color={badgeColor(goal.status)}
                background={false}
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size={ButtonSize.Small}
                variant={ButtonVariant.GhostDestructive}
                content={ButtonContent.Icon}
                aria-label="Clear goal"
                disabled={busy}
                onClick={() => void draft.clear()}
              >
                <Icon iconName={IconName.Trash} size={16} />
              </Button>
              <Button
                type="button"
                size={ButtonSize.Small}
                variant={ButtonVariant.Primary}
                className="!rounded-full"
                disabled={busy || !trimmed || !draft.changed || draft.budgetInvalid}
                onClick={() => void (draft.editingExisting ? draft.save() : createAndClose())}
              >
                {goal.status === "complete" ? "Replace" : "Update"}
              </Button>
              {closeButton}
            </div>
          </div>
          <div className="flex items-center gap-4 px-3 py-2">
            <BudgetSwitch draft={draft} />
            {draft.budgetOn ? <BudgetRange draft={draft} className="gap-2" /> : null}
          </div>
          {draft.budgetOn ? <BudgetNote draft={draft} className="px-3 pb-2" /> : null}
        </>
      ) : (
        <>
          <div className="flex items-center gap-4 py-1 pr-1 pl-3">
            <BudgetSwitch draft={draft} />
            {draft.budgetOn ? (
              <BudgetRange draft={draft} className="gap-3" />
            ) : (
              <span className="flex-1" />
            )}
            {closeButton}
          </div>
          {draft.budgetOn ? <BudgetNote draft={draft} className="px-3 pb-2" /> : null}
        </>
      )}
      <div className="flex items-end">
        <textarea
          ref={field}
          className="block min-w-0 flex-1 resize-none border-none bg-transparent py-3 pr-2 pl-4 text-medium text-input outline-none placeholder:text-input-placeholder"
          rows={1}
          aria-label="Goal objective"
          placeholder={OBJECTIVE_PLACEHOLDER}
          value={draft.objective}
          onChange={(event) => draft.setObjective(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            if (!draft.changed) return;
            void (draft.editingExisting ? draft.save() : createAndClose());
          }}
        />
        <ComposerIconButton
          compact={false}
          type="button"
          variant={ButtonVariant.GhostHighlightedAccent}
          disabled={corner.disabled || busy}
          loading={busy && corner.kind === "save"}
          aria-label={corner.label}
          onClick={() => {
            if (corner.kind === "pause") void draft.setStatus("paused");
            else if (corner.kind === "resume") void draft.setStatus("active");
            else void createAndClose();
          }}
        >
          <Icon iconName={corner.icon} />
        </ComposerIconButton>
      </div>
    </>
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

interface GoalMobileModalProps {
  draft: GoalDraft;
  open: boolean;
  onClose: () => void;
}

/**
 * The phone's goal editor. The card has no room for the budget beside the
 * objective there, so the flag opens this full-screen dialog instead.
 */
function GoalMobileModal({ draft, open, onClose }: GoalMobileModalProps) {
  const { goalQuery, goal, busy } = draft;
  const ready = !goalQuery.isPending && !goalQuery.isError;
  const submit = async () => {
    if (!draft.changed || (await draft.save())) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Set Durable Goal"
      bodyClassName="p-0 pb-20 [&>*]:shrink-0"
      footer={
        ready ? (
          <>
            {goal ? (
              <StickyButton
                variant={ButtonVariant.GhostDestructive}
                content={ButtonContent.Icon}
                className="mr-auto"
                aria-label="Clear goal"
                disabled={busy}
                onClick={() => void draft.clear()}
              >
                <Icon iconName={IconName.Trash} />
              </StickyButton>
            ) : null}
            {goal && draft.editingExisting ? (
              <StickyButton
                variant={ButtonVariant.Ghost}
                disabled={busy}
                onClick={() => void draft.setStatus(goal.status === "active" ? "paused" : "active")}
              >
                {goal.status === "active" ? "Pause" : "Resume"}
              </StickyButton>
            ) : null}
            <StickyButton
              variant={ButtonVariant.Primary}
              disabled={busy || draft.budgetInvalid}
              onClick={() => void submit()}
            >
              {draft.editingExisting ? "Update" : goal ? "Replace" : "Submit"}
            </StickyButton>
          </>
        ) : null
      }
    >
      <section className="p-4">
        <p className="text-medium text-basic-primary">{GOAL_HINT}</p>
      </section>
      {!ready ? (
        <section className="p-4">
          <p
            className={cn(
              "text-small",
              goalQuery.isError ? "text-error-primary" : "text-basic-secondary",
            )}
          >
            {goalQuery.isError ? "Goal state could not be loaded." : "Loading goal…"}
          </p>
        </section>
      ) : (
        <>
          {goal ? (
            <section className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4">
              <span className="header-md text-accent-primary">Current Goal</span>
              <span className="text-medium text-accent-tertiary">{usageLabel(goal)}</span>
              <Badge
                text={statusLabel(goal.status)}
                color={badgeColor(goal.status)}
                background={false}
              />
            </section>
          ) : null}
          <section className="p-4">
            <TextArea
              textAreaSize={TextAreaSize.Large}
              textAreaClassName="h-60 resize-none"
              aria-label="Goal objective"
              placeholder={OBJECTIVE_PLACEHOLDER}
              value={draft.objective}
              onChange={(event) => draft.setObjective(event.target.value)}
            />
          </section>
          <section className="flex flex-col gap-4 p-4">
            <div className="flex items-center gap-2">
              <span className="label-small min-w-0 flex-1 truncate text-basic-primary">
                Token Budget
              </span>
              <Switch
                size={SwitchSize.Large}
                checked={draft.budgetOn}
                disabled={busy}
                aria-label="Token budget"
                onChange={draft.toggleBudget}
              />
            </div>
            {draft.budgetOn ? (
              <>
                <BudgetRange draft={draft} className="gap-3" large />
                <BudgetNote draft={draft} />
              </>
            ) : (
              <p className="text-small text-basic-muted">No token limit</p>
            )}
          </section>
        </>
      )}
    </Modal>
  );
}
