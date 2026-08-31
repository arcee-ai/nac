import { useMemo } from "react";

import SegmentDetailRow, {
  type SegmentDetailItem,
} from "@/app/components/inspector/agent-segments/SegmentDetailRow";
import type { SidebarBoxContent } from "@/app/components/inspector/agent-segments/SegmentDetailBox";
import {
  configForSegment,
  ToolCallLabelState,
  type AgentSegment,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import { cn } from "@/app/lib/cn";
import "./agent-segments.css";

function boxesForSegment(segment: AgentSegment): {
  boxes: SidebarBoxContent[];
  copyText: string;
} {
  if (segment.kind === "thinking") {
    const content = segment.text.trim() || "No reasoning content";
    return {
      boxes: [{ kind: "markdown", key: `${segment.key}-body`, content }],
      copyText: segment.text,
    };
  }
  const boxes: SidebarBoxContent[] = [];
  if (segment.presentation.summary) {
    boxes.push({
      kind: "code",
      key: `${segment.key}-input`,
      content: segment.presentation.summary,
    });
  }
  if (segment.presentation.resultPreview) {
    boxes.push({
      kind: "markdown",
      key: `${segment.key}-output`,
      content: segment.presentation.resultPreview,
    });
  }
  return {
    boxes,
    copyText: [
      segment.presentation.summary
        ? `Input:\n${segment.presentation.summary}`
        : "",
      segment.presentation.resultPreview
        ? `Output:\n${segment.presentation.resultPreview}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function itemsFromGroup(group: AgentToolsGroup): SegmentDetailItem[] {
  return group.segments.map((segment) => {
    const { boxes, copyText } = boxesForSegment(segment);
    const live =
      segment.kind === "thinking"
        ? segment.streaming
        : segment.presentation.status === "pending" ||
          segment.presentation.status === "running";
    return {
      key: segment.key,
      config: configForSegment(segment),
      state: live ? ToolCallLabelState.Active : ToolCallLabelState.Default,
      durationMs: segment.kind === "thinking" ? segment.durationMs : null,
      copyText,
      boxes,
    };
  });
}

export function SegmentDetailList({
  group,
  className,
}: {
  group: AgentToolsGroup;
  className?: string;
}) {
  const items = useMemo(() => itemsFromGroup(group), [group]);
  if (items.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full label-small text-basic-tertiary",
          className,
        )}
      >
        No reasoning or tool calls
      </div>
    );
  }
  const penultimateIndex = items.length - 2;
  return (
    <div className={className}>
      {items.map((item, index) => (
        <SegmentDetailRow
          key={item.key}
          item={item}
          isLast={index === items.length - 1}
          animateConnector={group.inProgress && index === penultimateIndex}
        />
      ))}
    </div>
  );
}
