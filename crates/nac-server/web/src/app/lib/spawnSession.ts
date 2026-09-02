import {
  isStandaloneToolName,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import { formatSeconds } from "@/app/lib/format";
import type { TranscriptTurn } from "@/app/lib/transcript";
import type { SessionAssignmentRecord } from "@/app/types/api";

const CHILD_ID_KEY = /"(?:child_session_id|orchestrator_session_id)"\s*:\s*"([^"]+)"/;

/** Child session id from a `session_spawn` tool result, including truncated JSON. */
export function spawnChildSessionId(resultPreview: string | null | undefined): string | null {
  if (!resultPreview) return null;
  try {
    const value: unknown = JSON.parse(resultPreview);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const child = record.child_session_id;
      const orchestrator = record.orchestrator_session_id;
      if (typeof child === "string" && child.trim()) return child;
      if (typeof orchestrator === "string" && orchestrator.trim()) return orchestrator;
    }
  } catch {
    // The tool preview is bounded; fall through to a key scrape.
  }
  return CHILD_ID_KEY.exec(resultPreview)?.[1] ?? null;
}

export function groupIsSpawn(group: AgentToolsGroup): boolean {
  return group.segments.some(
    (segment) => segment.kind === "tool" && isStandaloneToolName(segment.presentation.name),
  );
}

export function spawnChildIdFromGroup(group: AgentToolsGroup): string | null {
  const lead = group.segments[0];
  if (lead?.kind !== "tool") return null;
  return spawnChildSessionId(lead.presentation.resultPreview);
}

export function assignmentForSpawn(
  assignments: SessionAssignmentRecord[] | undefined,
  group: AgentToolsGroup,
): SessionAssignmentRecord | null {
  const childId = spawnChildIdFromGroup(group);
  if (childId) {
    return assignments?.find((row) => row.child_session_id === childId) ?? null;
  }
  const description = group.label.trim();
  if (!description) return null;
  const matches = (assignments ?? []).filter((row) => row.description === description);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** Last few child-transcript fragments for the spawn card peek. */
export function childPreviewLines(
  turns: TranscriptTurn[],
  thinking: boolean,
): string[] {
  const lines: string[] = [];
  for (const turn of turns) {
    if (turn.kind !== "model") continue;
    for (const block of turn.blocks) {
      if (block.kind === "thoughts") {
        if (block.streaming) lines.push("Thinking...");
        else if (block.durationMs != null) {
          lines.push(`Thoughts, ${formatSeconds(block.durationMs)}`);
        } else {
          lines.push("Thoughts");
        }
      } else if (block.kind === "tool-detail") {
        lines.push(block.presentation.label);
      } else if (block.kind === "tool") {
        lines.push(block.name);
      } else if (block.kind === "text") {
        const text = block.text.trim().replace(/\s+/g, " ");
        if (text) lines.push(text);
      }
    }
  }
  if (thinking && lines[lines.length - 1] !== "Thinking...") lines.push("Thinking...");
  return lines.slice(-3);
}
