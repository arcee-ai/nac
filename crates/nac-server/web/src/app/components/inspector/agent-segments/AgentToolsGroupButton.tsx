import { memo, useCallback, useMemo, useRef } from "react";

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

  return (
    <div className="my-4">
      <ToolsSegments
        items={items}
        label={group.inProgress ? "Working…" : group.label}
        durationMs={group.durationMs}
        inProgress={group.inProgress}
        active={active}
        ariaLabel={groupAriaLabel(group)}
        onClick={handleClick}
      />
    </div>
  );
});
