import { memo } from "react";

import { IconName, ToolsAndReasoningBadge } from "@/app/atoms";
import { segmentAction } from "@/app/features/insights/model/actionKinds";
import { doneLabel } from "@/app/features/insights/model/labels";
import type { InsightGroup } from "@/app/features/insights/model/types";
import { useLiveGroupLabel } from "@/app/features/insights/transcript/useLiveGroupLabel";
import { useInsightsNavigation } from "@/app/features/insights/useInsightsNavigation";

function fetchesOnly(group: InsightGroup): boolean {
  return group.segments.every((segment) => segmentAction(segment) === "web-fetch");
}

/**
 * A group of reasoning and tool calls in the transcript, which opens it in
 * Insights. Without `interactive` it is a plain summary.
 */
export const TranscriptGroupBadge = memo(function TranscriptGroupBadge({
  group,
  active,
  trailing,
  selected,
  interactive,
}: {
  group: InsightGroup;
  /** The turn is still producing output. */
  active: boolean;
  /** Nothing follows the group in its turn yet. */
  trailing: boolean;
  /** The group is the one Insights is showing. */
  selected: boolean;
  interactive: boolean;
}) {
  const { openGroup } = useInsightsNavigation();
  const liveLabel = useLiveGroupLabel(group, active, trailing);
  return (
    <ToolsAndReasoningBadge
      label={liveLabel ?? doneLabel(group)}
      inProgress={liveLabel !== null}
      selected={selected}
      // Never a remote favicon: loading one tells a third party which hosts the session fetched.
      leadingIcon={fetchesOnly(group) ? IconName.Globe : undefined}
      disabled={!interactive}
      onClick={interactive ? () => openGroup(group.id) : undefined}
    />
  );
});
