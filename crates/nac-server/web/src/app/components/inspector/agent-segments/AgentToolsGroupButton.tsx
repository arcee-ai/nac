import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import StepByStepDisplayer, {
  STEP_FADE_MS,
  buildStepperSteps,
} from "@/app/components/inspector/agent-segments/StepByStepDisplayer";
import ToolsSegments from "@/app/components/inspector/agent-segments/ToolsSegments";
import {
  actionListLabel,
  toolsItemsFromGroup,
  type AgentSegment,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";

function segmentsUnchanged(
  previous: readonly AgentSegment[],
  next: readonly AgentSegment[],
): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index++) {
    const left = previous[index];
    const right = next[index];
    if (left.key !== right.key || left.kind !== right.kind) return false;
    if (left.kind === "thinking" && right.kind === "thinking") {
      if (
        left.streaming !== right.streaming ||
        left.durationMs !== right.durationMs ||
        left.text !== right.text
      ) {
        return false;
      }
    } else if (left.kind === "tool" && right.kind === "tool") {
      if (
        left.presentation.status !== right.presentation.status ||
        left.presentation.name !== right.presentation.name ||
        left.presentation.label !== right.presentation.label
      ) {
        return false;
      }
    }
  }
  return true;
}

export const AgentToolsGroupButton = memo(function AgentToolsGroupButton({
  group,
  active,
  onSelect,
}: {
  group: AgentToolsGroup;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const items = useMemo(() => toolsItemsFromGroup(group), [group]);
  const label = actionListLabel(group);
  const steps = useMemo(() => buildStepperSteps(group), [group]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const groupId = group.id;
  const handleClick = useCallback(() => {
    onSelectRef.current(groupId);
  }, [groupId]);
  const [holdOpen, setHoldOpen] = useState(group.inProgress && steps.length > 0);

  useEffect(() => {
    if (group.inProgress && steps.length > 0) {
      setHoldOpen(true);
      return undefined;
    }
    const timeout = window.setTimeout(() => setHoldOpen(false), STEP_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [group.inProgress, steps.length]);

  const showSteps = holdOpen && steps.length > 0;

  return (
    <div className="relative my-6">
      <ToolsSegments
        items={items}
        label={label}
        durationMs={group.durationMs}
        inProgress={group.inProgress}
        active={active}
        ariaLabel={label}
        onClick={handleClick}
      />
      {showSteps ? (
        <div className="pointer-events-none absolute top-full left-0 right-0 z-10 pl-4">
          <StepByStepDisplayer steps={steps} faded={!group.inProgress} />
        </div>
      ) : null}
    </div>
  );
}, function agentToolsGroupButtonPropsAreEqual(prev, next) {
  if (prev.active !== next.active) return false;
  if (prev.group.id !== next.group.id) return false;
  if (prev.group.inProgress !== next.group.inProgress) return false;
  if (prev.group.durationMs !== next.group.durationMs) return false;
  if (prev.group.label !== next.group.label) return false;
  return segmentsUnchanged(prev.group.segments, next.group.segments);
});
