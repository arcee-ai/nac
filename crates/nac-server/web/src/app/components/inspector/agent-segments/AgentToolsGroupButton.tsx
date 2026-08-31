import { useMemo } from "react";

import { ToolsSegments } from "@/app/components/inspector/agent-segments/ToolsSegments";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import {
  MAX_PILLS_DESKTOP,
  MAX_PILLS_MOBILE,
  toolsItemsFromGroup,
  visibleToolsItems,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";

export function AgentToolsGroupButton({
  group,
  active,
  onSelect,
}: {
  group: AgentToolsGroup;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const isMobile = useIsMobile();
  const maxPills = isMobile ? MAX_PILLS_MOBILE : MAX_PILLS_DESKTOP;
  const { items, overflowCount } = useMemo(() => {
    return visibleToolsItems(toolsItemsFromGroup(group), maxPills);
  }, [group, maxPills]);

  return (
    <div className="my-4">
      <ToolsSegments
        items={items}
        overflowCount={overflowCount}
        durationMs={group.durationMs}
        inProgress={group.inProgress}
        active={active}
        ariaLabel={group.label}
        onClick={() => onSelect(group.id)}
      />
    </div>
  );
}
