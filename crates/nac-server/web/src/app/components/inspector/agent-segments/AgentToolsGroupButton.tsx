import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import StepByStepDisplayer, {
  STEP_FADE_MS,
} from "@/app/components/inspector/agent-segments/StepByStepDisplayer";
import ToolsSegments from "@/app/components/inspector/agent-segments/ToolsSegments";
import { groupAriaLabel, toolsItemsFromGroup, type AgentToolsGroup } from "@/app/lib/agentSegments";

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
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const groupId = group.id;
  const handleClick = useCallback(() => onSelectRef.current(groupId), [groupId]);
  const hasSteps = group.segments.length > 0;
  const [holdOpen, setHoldOpen] = useState(group.inProgress && hasSteps);

  useEffect(() => {
    if (group.inProgress && hasSteps) {
      setHoldOpen(true);
      return undefined;
    }
    const timeout = window.setTimeout(() => setHoldOpen(false), STEP_FADE_MS);
    return () => window.clearTimeout(timeout);
  }, [group.inProgress, hasSteps]);

  return (
    <div className="relative my-6">
      <ToolsSegments
        items={items}
        label={group.inProgress ? "Working…" : group.label}
        durationMs={group.durationMs}
        inProgress={group.inProgress}
        active={active}
        ariaLabel={groupAriaLabel(group)}
        onClick={handleClick}
      />
      {holdOpen ? (
        <div className="pointer-events-none absolute top-full right-0 left-0 z-10 pl-4">
          <StepByStepDisplayer group={group} faded={!group.inProgress} />
        </div>
      ) : null}
    </div>
  );
});
