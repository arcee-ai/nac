import {
  configForSegment,
  segmentIsLive,
  toolSegmentFailed,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import { formatSeconds } from "@/app/lib/format";

export interface StepByStepStep {
  key: string;
  label: string;
  statusLabel: string;
  active: boolean;
  failed: boolean;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+?)\*\*/g, "$1")
    .replace(/`+([^`]+?)`+/g, "$1")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastCompleteSentence(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const matches = [...trimmed.matchAll(/[.!?](?=\s|$)/g)];
  if (matches.length === 0) return undefined;
  const end = (matches.at(-1)?.index ?? -1) + 1;
  return stripInlineMarkdown(trimmed.slice(0, end)) || undefined;
}

export function buildStepperSteps(group: AgentToolsGroup): StepByStepStep[] {
  return group.segments.map((segment) => {
    const config = configForSegment(segment);
    const active = segmentIsLive(segment);
    if (segment.kind === "thinking") {
      return {
        key: segment.key,
        label: active
          ? (lastCompleteSentence(segment.text) ?? config.inProgressLabel)
          : config.regularLabel,
        statusLabel: active ? "Thinking" : formatSeconds(segment.durationMs) || "Complete",
        active,
        failed: false,
      };
    }
    return {
      key: segment.key,
      label: active ? config.inProgressLabel : segment.presentation.label,
      statusLabel: segment.presentation.statusLabel,
      active,
      failed: toolSegmentFailed(segment),
    };
  });
}
