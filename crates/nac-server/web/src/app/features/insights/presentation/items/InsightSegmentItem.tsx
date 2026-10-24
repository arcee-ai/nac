import { InsightItem, InsightItemState } from "@/app/atoms";
import { segmentAction } from "@/app/features/insights/model/actionKinds";
import { inProgressLabel } from "@/app/features/insights/model/labels";
import { segmentStatus } from "@/app/features/insights/model/status";
import type { ActionStatus, InsightSegment } from "@/app/features/insights/model/types";
import { detailIcon, itemState } from "@/app/features/insights/presentation/actionPresentation";
import {
  readOutputContent,
  runCommandContent,
  writeCommandContent,
} from "@/app/features/insights/presentation/items/CommandItems";
import { fileContent } from "@/app/features/insights/presentation/items/FileItems";
import {
  getGoalContent,
  goalChangeContent,
} from "@/app/features/insights/presentation/items/GoalItems";
import type {
  ItemContent,
  ItemContext,
  ToolSegment,
} from "@/app/features/insights/presentation/items/itemContent";
import { otherContent } from "@/app/features/insights/presentation/items/OtherItem";
import { reasoningContent } from "@/app/features/insights/presentation/items/ReasoningItem";
import {
  fileSearchContent,
  webContent,
} from "@/app/features/insights/presentation/items/SearchItems";
import { sessionContent } from "@/app/features/insights/presentation/items/SessionItems";
import { useErrorLine } from "@/app/features/insights/presentation/items/useErrorLine";
import {
  deleteThreadContent,
  worksetContent,
} from "@/app/features/insights/presentation/items/WorksetItems";

const TRAILING_ELLIPSIS = /…$/u;

function toolContent(segment: ToolSegment, context: ItemContext): ItemContent {
  switch (segment.action) {
    case "read-file":
    case "write-file":
    case "edit-file":
      return fileContent(segment);
    case "web-search":
    case "web-fetch":
      return webContent(segment, context);
    case "glob":
    case "grep":
      return fileSearchContent(segment, context);
    case "run-command":
      return runCommandContent(segment, context);
    case "write-command":
      return writeCommandContent(segment, context);
    case "read-command-output":
      return readOutputContent(segment, context);
    case "create-goal":
    case "update-goal":
      return goalChangeContent(segment);
    case "get-goal":
      return getGoalContent(segment, context);
    case "session-status":
    case "session-steer":
    case "session-read":
    case "session-wait":
    case "session-cancel":
      return sessionContent(segment, context);
    case "delete-thread":
      return deleteThreadContent(segment);
    default:
      return otherContent(segment, context);
  }
}

function segmentContent(segment: InsightSegment, context: ItemContext): ItemContent {
  if (segment.kind === "reasoning") return reasoningContent(segment);
  if (segment.kind === "workset") return worksetContent(segment, context);
  return toolContent(segment, context);
}

/** The item appends its own ellipsis while loading. */
function loadingTitle(segment: InsightSegment, status: ActionStatus): string {
  if (status === "pending") return "Awaiting approval";
  return inProgressLabel(segment).replace(TRAILING_ELLIPSIS, "");
}

export function InsightSegmentItem({
  segment,
  active,
  context,
}: {
  segment: InsightSegment;
  active: boolean;
  context: ItemContext;
}) {
  const status = segmentStatus(segment);
  const state = itemState(status);
  const content = segmentContent(segment, context);
  const error = useErrorLine(segment, context.sessionId, state === InsightItemState.Error);
  return (
    <InsightItem
      icon={detailIcon(segmentAction(segment))}
      title={state === InsightItemState.Loading ? loadingTitle(segment, status) : content.title}
      state={state}
      active={active}
      copyText={content.copyText}
      errorMessage={error.message}
      errorAction={error.action}
    >
      {content.body?.(state)}
    </InsightItem>
  );
}
