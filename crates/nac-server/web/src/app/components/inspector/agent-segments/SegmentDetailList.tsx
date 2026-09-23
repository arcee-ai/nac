import { useEffect, useMemo, useRef } from "react";

import type { SegmentDetailBoxContent } from "@/app/components/inspector/agent-segments/SegmentDetailBox";
import SegmentDetailRow, {
  type SegmentDetailItem,
} from "@/app/components/inspector/agent-segments/SegmentDetailRow";
import {
  configForSegment,
  segmentIsLive,
  toolSegmentFailed,
  type AgentSegment,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import { useActionSegmentScroll, useSelectedActionSegmentKey } from "@/app/lib/actionExpand";
import { cn } from "@/app/lib/cn";
import { formatSeconds } from "@/app/lib/format";
import "./agent-segments.css";

function detailForSegment(segment: AgentSegment): {
  boxes: SegmentDetailBoxContent[];
  copyText: string;
} {
  if (segment.kind === "thinking") {
    return {
      boxes: [{ kind: "markdown", key: `${segment.key}-body`, content: segment.text }],
      copyText: segment.text,
    };
  }

  const error = toolSegmentFailed(segment);
  const boxes: SegmentDetailBoxContent[] = [];
  if (segment.presentation.summary) {
    boxes.push({
      kind: "code",
      key: `${segment.key}-input`,
      content: segment.presentation.summary,
    });
  }
  if (segment.presentation.resultPreview) {
    boxes.push({
      kind: segment.presentation.name === "exec_command" ? "code" : "markdown",
      key: `${segment.key}-output`,
      content: segment.presentation.resultPreview,
      error,
    });
  }
  return {
    boxes,
    copyText: [
      segment.presentation.summary ? `Input:\n${segment.presentation.summary}` : "",
      segment.presentation.resultPreview ? `Output:\n${segment.presentation.resultPreview}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function itemsFromGroup(group: AgentToolsGroup): SegmentDetailItem[] {
  return group.segments.map((segment) => {
    const config = configForSegment(segment);
    const { boxes, copyText } = detailForSegment(segment);
    if (segment.kind === "thinking") {
      const duration = formatSeconds(segment.durationMs);
      return {
        key: segment.key,
        config,
        label: segment.streaming ? config.inProgressLabel : config.regularLabel,
        statusLabel: segment.streaming ? "Thinking" : duration || "Complete",
        live: segment.streaming,
        failed: false,
        copyText,
        boxes,
      };
    }
    return {
      key: segment.key,
      config,
      label: segmentIsLive(segment) ? config.inProgressLabel : segment.presentation.label,
      statusLabel: segment.presentation.statusLabel,
      live: segmentIsLive(segment),
      failed: toolSegmentFailed(segment),
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
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollTo = useActionSegmentScroll();
  const selectedKey = useSelectedActionSegmentKey();

  useEffect(() => {
    if (!scrollTo) return;
    const root = rootRef.current;
    if (!root) return;
    const element = Array.from(root.querySelectorAll<HTMLElement>("[data-segment-key]")).find(
      (candidate) => candidate.dataset.segmentKey === scrollTo.key,
    );
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const marginTop = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const top =
      root.scrollTop +
      element.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      marginTop;
    root.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [scrollTo]);

  if (items.length === 0) {
    return (
      <div className={cn("label-small text-basic-muted", className)}>
        No reasoning or tool calls
      </div>
    );
  }
  return (
    <div ref={rootRef} className={className}>
      {items.map((item, index) => (
        <SegmentDetailRow
          key={item.key}
          item={item}
          isLast={index === items.length - 1}
          highlighted={selectedKey === item.key}
        />
      ))}
    </div>
  );
}
