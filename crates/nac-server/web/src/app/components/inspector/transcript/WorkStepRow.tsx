import { memo, useId, useState } from "react";

import { Icon, IconName } from "@/app/atoms";
import { ToolCallDetail } from "@/app/components/inspector/ToolCallDetail";
import { segmentAction } from "@/app/features/insights/model/actionKinds";
import { rowIcon } from "@/app/features/insights/presentation/actionPresentation";
import { openOptionsFor } from "@/app/features/insights/transcript/openOptions";
import {
  INSIGHTS_DETAIL_ID,
  useInsightsNavigation,
} from "@/app/features/insights/useInsightsNavigation";
import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";

import { stepLabel } from "./stepLabels";
import type { WorkStep } from "./foldLayout";

const ROW =
  "group/row flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 text-left h-8 max-md:min-h-11 max-md:h-auto";

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus-outline)]";

const STATUS_TEXT: Record<string, string | null> = {
  failed: "Failed",
  pending: "Waiting for approval",
  running: null,
  ready: null,
};

/**
 * One step of a turn's work: a 16px glyph, one line naming what it did, and
 * how long it took. A step with something to show opens it in place: the
 * reasoning it wrote, or what its tool call returned.
 */
export const WorkStepRow = memo(function WorkStepRow({
  step,
  streaming,
  interactive,
}: {
  step: WorkStep;
  /** The turn is live, so reasoning may still be arriving. */
  streaming: boolean;
  interactive: boolean;
}) {
  const detailId = useId();
  const [open, setOpen] = useState(false);
  const { openGroup } = useInsightsNavigation();

  if (step.kind === "note") {
    return (
      <li className="py-1.5 pl-[34px] pr-1.5">
        <Markdown className="focus-note [&>:first-child]:!mt-0 [&>:last-child]:!mb-0">
          {step.text}
        </Markdown>
      </li>
    );
  }

  const { segment } = step;
  const label = stepLabel(segment);
  const action = segmentAction(segment);
  const presentation = segment.kind === "tool" ? segment.presentation : null;
  const reasoning = segment.kind === "reasoning" ? segment.text : null;
  const expandable = Boolean(presentation || reasoning);
  const statusText = STATUS_TEXT[label.status];
  const failed = label.status === "failed";
  const awaiting = label.status === "pending";
  const running = label.status === "running";

  const content = (
    <>
      <Icon
        iconName={failed ? IconName.Danger : rowIcon(action)}
        size={16}
        aria-hidden
        className={cn(
          "shrink-0",
          failed
            ? "!text-fill-error-primary"
            : awaiting
              ? "!text-[var(--f-amber)]"
              : "!text-fill-basic-tertiary",
        )}
      />
      <span
        className="flex min-w-0 flex-1 items-baseline gap-1.5 type-body-chrome"
        title={label.title ?? undefined}
      >
        <span
          className={cn(
            "shrink-0",
            running ? "focus-shimmer" : failed ? "text-error-primary" : "text-basic-secondary",
          )}
        >
          {label.verb}
        </span>
        {label.argument ? (
          <span className="min-w-0 truncate code code-small text-basic-tertiary">
            {label.argument}
          </span>
        ) : null}
      </span>
      {statusText ? (
        <span
          className={cn(
            "shrink-0 type-meta",
            failed ? "text-error-primary" : "text-[var(--f-amber-text)]",
          )}
        >
          {statusText}
        </span>
      ) : null}
      {label.duration ? (
        <span className="shrink-0 type-meta tabular text-basic-muted">{label.duration}</span>
      ) : null}
      {expandable ? (
        <Icon
          iconName={IconName.Right}
          size={14}
          aria-hidden
          className={cn(
            "shrink-0 !text-fill-basic-muted transition-transform duration-150 ease-out motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      ) : (
        <span aria-hidden className="w-3.5 shrink-0" />
      )}
    </>
  );

  return (
    <li className="flex min-w-0 flex-col">
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailId}
          onClick={() => setOpen((value) => !value)}
          className={cn(ROW, FOCUS_RING, "hover:bg-[var(--f-wash-1)]")}
        >
          {content}
        </button>
      ) : (
        <div className={ROW}>{content}</div>
      )}
      {open ? (
        <div id={detailId} className="flex min-w-0 flex-col items-start gap-2 pt-1 pb-3 pl-[34px]">
          {presentation ? <ToolCallDetail tool={presentation} /> : null}
          {reasoning ? (
            <div className="reasoning-prose w-full min-w-0 text-basic-secondary">
              <Markdown streaming={streaming}>{reasoning}</Markdown>
            </div>
          ) : null}
          {interactive ? (
            <button
              type="button"
              aria-controls={INSIGHTS_DETAIL_ID}
              onClick={(event) => openGroup(step.groupId, step.key, openOptionsFor(event))}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-pill px-2 -ml-2 type-meta text-basic-tertiary hover:bg-[var(--f-wash-1)] hover:text-basic-primary max-md:min-h-11",
                FOCUS_RING,
              )}
            >
              Details in Insights
              <Icon iconName={IconName.External} size={12} aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
});
