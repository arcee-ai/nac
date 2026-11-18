import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { memo, use, useId, useMemo, useState } from "react";

import { Icon, IconName } from "@/app/atoms";
import { NativeTaskLinks } from "@/app/features/insights/transcript/NativeTaskLink";
import { openOptionsFor } from "@/app/features/insights/transcript/openOptions";
import {
  INSIGHTS_DETAIL_ID,
  useInsightsNavigation,
} from "@/app/features/insights/useInsightsNavigation";
import { cn } from "@/app/lib/cn";
import { useTranscriptSessionId } from "@/app/features/insights/transcript/transcriptTurns";
import { FoldChoicesContext } from "./foldChoices";

import {
  foldSegments,
  formatWorkDuration,
  isPinnedStatus,
  liveFoldLabel,
  settledFoldLabel,
  stepStatus,
  workSentence,
  type WorkFold,
} from "./foldLayout";
import { WorkStepRow } from "./WorkStepRow";
import { ElapsedClock } from "./LiveStatusLine";

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus-outline)]";

/**
 * Everything a turn did on its way to the answer, folded behind one quiet
 * line: "Worked for 1m 12s · Read 4 files, ran 2 commands". The chevron opens
 * it in place into one row per step, and each row opens into what it did.
 *
 * Compact density keeps it folded, detailed opens it; a toggle by the reader
 * wins over both. Failed steps and steps waiting for approval are never
 * folded away: they stay listed under the line whatever the fold says.
 */
export const WorkFoldView = memo(function WorkFoldView({
  fold,
  turnKey,
  active,
  turnDurationMs,
  totalTurnDuration = false,
  selectedGroupId,
  interactive,
  liveLabel = null,
  runStartedAt = null,
}: {
  fold: WorkFold;
  turnKey: string;
  /** The turn is still producing output. */
  active: boolean;
  /** Wall-clock time of the run behind the turn, once it finished. */
  turnDurationMs: number | null;
  /** Duration covers the whole turn when activity spans several folds. */
  totalTurnDuration?: boolean;
  /** The Insights group the panels point at, if it is one of these. */
  selectedGroupId: string | null;
  interactive: boolean;
  liveLabel?: string | null;
  runStartedAt?: number | null;
}) {
  const listId = useId();
  const { useTranscriptDensity } = useNativeRuntime().stores.transcriptDensityStore;
  const density = useTranscriptDensity();
  const inheritedChoices = use(FoldChoicesContext);
  const [localChoices] = useState(() => new Map<string, boolean>());
  const choices = inheritedChoices ?? localChoices;
  const sessionId = useTranscriptSessionId();
  const choiceKey = JSON.stringify([sessionId, turnKey, fold.key]);
  const [toggled, setToggled] = useState<boolean | null>(() => choices?.get(choiceKey) ?? null);
  const { openGroup } = useInsightsNavigation();
  const open = toggled ?? density === "detailed";

  const segments = useMemo(() => foldSegments(fold), [fold]);
  const summary = workSentence(segments);
  const totalTime = totalTurnDuration ? formatWorkDuration(turnDurationMs) : null;
  const label = active
    ? liveLabel
      ? `${liveLabel}${summary ? ` · ${summary}` : ""}`
      : liveFoldLabel(segments)
    : totalTime
      ? `Total time ${totalTime} · ${settledFoldLabel(segments, null)}`
      : settledFoldLabel(segments, turnDurationMs);
  const failedCount = useMemo(
    () => fold.steps.filter((step) => stepStatus(step) === "failed").length,
    [fold],
  );
  const pinned = useMemo(
    () => (open ? [] : fold.steps.filter((step) => isPinnedStatus(stepStatus(step)))),
    [fold, open],
  );
  const launched = fold.steps.flatMap((step) =>
    step.kind === "segment" &&
    step.segment.kind === "tool" &&
    step.segment.presentation?.launchedTask
      ? [
          {
            key: step.key,
            groupId: step.groupId,
            task: step.segment.presentation.launchedTask,
          },
        ]
      : [],
  );
  const selected = selectedGroupId !== null && fold.groupIds.includes(selectedGroupId);
  const firstGroup = fold.groupIds[0];

  return (
    <FoldChoicesContext value={choices}>
      <div className="flex w-full min-w-0 flex-col" data-work-fold>
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            aria-current={selected ? "true" : undefined}
            aria-controls={open || pinned.length > 0 ? listId : undefined}
            onClick={() => {
              choices?.set(choiceKey, !open);
              setToggled(!open);
            }}
            className={cn(
              "group/fold -ml-1.5 inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md px-1.5 max-md:min-h-11",
              "type-body-chrome transition-colors duration-150 ease-out hover:bg-[var(--f-wash-1)] hover:text-basic-primary",
              selected ? "text-basic-primary" : "text-basic-tertiary",
              FOCUS_RING,
            )}
          >
            <Icon
              iconName={IconName.Right}
              size={16}
              aria-hidden
              className={cn(
                "shrink-0 !text-current transition-transform duration-150 ease-out motion-reduce:transition-none",
                open && "rotate-90",
              )}
            />
            <span className="min-w-0 text-left max-md:line-clamp-2 md:truncate">
              {label}
              {failedCount > 0 && !active ? (
                <span className="text-error-primary"> · {failedCount} failed</span>
              ) : null}
            </span>
          </button>
          {active && runStartedAt != null && runStartedAt > 0 ? (
            <ElapsedClock since={runStartedAt} />
          ) : null}
        </div>

        {open ? (
          <div className="flex min-w-0 flex-col pt-1">
            <ol
              id={listId}
              aria-label="Steps"
              className="ml-[6px] flex min-w-0 flex-col border-l border-tertiary pl-2"
            >
              {fold.steps.map((step) => (
                <WorkStepRow
                  key={step.key}
                  step={step}
                  streaming={active}
                  interactive={interactive}
                  choiceKey={JSON.stringify([sessionId, turnKey, fold.key, step.key])}
                />
              ))}
            </ol>
            {interactive && firstGroup ? (
              <div className="pl-[14px] pt-1">
                <button
                  type="button"
                  aria-controls={INSIGHTS_DETAIL_ID}
                  onClick={(event) => openGroup(firstGroup, undefined, openOptionsFor(event))}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-pill px-2 type-meta text-basic-tertiary hover:bg-[var(--f-wash-1)] hover:text-basic-primary max-md:min-h-11",
                    FOCUS_RING,
                  )}
                >
                  Open in Insights
                  <Icon iconName={IconName.External} size={12} aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        ) : pinned.length > 0 ? (
          <ol
            id={listId}
            aria-label="Steps that need attention"
            className="ml-[6px] flex min-w-0 flex-col border-l border-tertiary pl-2 pt-1"
          >
            {pinned.map((step) => (
              <WorkStepRow
                key={step.key}
                step={step}
                streaming={active}
                interactive={interactive}
                choiceKey={JSON.stringify([sessionId, turnKey, fold.key, step.key])}
              />
            ))}
          </ol>
        ) : null}

        {interactive && launched.length > 0 ? (
          <div className="flex flex-col items-start gap-1 pt-2">
            <NativeTaskLinks candidates={launched} />
          </div>
        ) : null}
      </div>
    </FoldChoicesContext>
  );
});
