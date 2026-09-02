import {
  partitionAgentTranscript,
  turnOriginKey,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import type { ThreadState, TranscriptBlock, TranscriptThread, TranscriptTurn, UserTurn } from "@/app/lib/transcript";

export type ActionFilter = "all" | "threads" | "tools" | "sessions" | "worksets";

export type ActionItem =
  | { kind: "group"; id: string; group: AgentToolsGroup }
  | {
      kind: "thread";
      id: string;
      name: string;
      episodeKey: string;
      nested: boolean;
      state: ThreadState;
      action: string;
    }
  | { kind: "spawn"; id: string; group: AgentToolsGroup; title: string }
  | {
      kind: "workset";
      id: string;
      worksetId: string;
      pending: boolean;
      title: string;
    };

export interface ActionTurnSection {
  key: string;
  number: number;
  prompt: string;
  createdAt: string | null;
  items: ActionItem[];
}

function worksetTitle(block: Extract<TranscriptBlock, { kind: "workset" }>): string {
  if (block.worksetId) return `Worksets_${block.worksetId}`;
  return block.pending ? "Defining worksets…" : "Worksets";
}

function itemsFromModelTurn(turn: TranscriptTurn, live: boolean): ActionItem[] {
  if (turn.kind !== "model") return [];
  const originKey = turnOriginKey(turn);
  const items: ActionItem[] = [];
  let nestThreads = false;
  for (const part of partitionAgentTranscript(turn, live)) {
    if (part.kind === "group") {
      items.push({ kind: "group", id: part.group.id, group: part.group });
      nestThreads = true;
      continue;
    }
    if (part.kind === "spawn") {
      const lead = part.group.segments[0];
      const title =
        lead && lead.kind === "tool"
          ? (lead.presentation.summary ?? lead.presentation.label)
          : part.group.label;
      items.push({ kind: "spawn", id: part.group.id, group: part.group, title });
      nestThreads = false;
      continue;
    }
    const block = part.block;
    if (block.kind === "workset") {
      items.push({
        kind: "workset",
        id: `${originKey}:workset-${block.key}`,
        worksetId: block.worksetId,
        pending: block.pending,
        title: worksetTitle(block),
      });
      nestThreads = true;
      continue;
    }
    if (block.kind === "wave") {
      for (const row of block.rows) {
        for (const thread of row) {
          items.push(threadItem(thread, nestThreads));
        }
      }
    }
  }
  return newestFirstActionItems(items);
}

/** Keep a group with the nested threads that follow it; put later units first. */
function newestFirstActionItems(items: ActionItem[]): ActionItem[] {
  const units: ActionItem[][] = [];
  let current: ActionItem[] = [];
  for (const item of items) {
    if (item.kind === "thread" && item.nested && current.length > 0) {
      current.push(item);
      continue;
    }
    if (current.length > 0) units.push(current);
    current = [item];
  }
  if (current.length > 0) units.push(current);
  units.reverse();
  return units.flat();
}

function threadItem(thread: TranscriptThread, nested: boolean): ActionItem {
  return {
    kind: "thread",
    id: thread.key,
    name: thread.name,
    episodeKey: thread.key,
    nested,
    state: thread.state,
    action: thread.action,
  };
}

/**
 * Newest user turn first. Inside a turn, thoughts/tools, spawned sessions,
 * and thread dispatches are also newest-first so PanelSplit lists match.
 */
export function buildActionTimeline(
  turns: readonly TranscriptTurn[],
  liveTurnOriginKey?: string | null,
): ActionTurnSection[] {
  const sections: Omit<ActionTurnSection, "number">[] = [];
  let pendingUser: UserTurn | null = null;

  for (const turn of turns) {
    if (turn.kind === "user") {
      pendingUser = turn;
      continue;
    }
    if (turn.kind !== "model") {
      pendingUser = null;
      continue;
    }
    const originKey = turnOriginKey(turn);
    const items = itemsFromModelTurn(turn, liveTurnOriginKey === originKey);
    if (items.length === 0) {
      pendingUser = null;
      continue;
    }
    sections.push({
      key: originKey,
      prompt: pendingUser?.text ?? "",
      createdAt: pendingUser?.createdAt ?? null,
      items,
    });
    pendingUser = null;
  }

  const newestFirst = sections.reverse();
  return newestFirst.map((section, index) => ({
    ...section,
    number: newestFirst.length - index,
  }));
}

export function filterActionTimeline(
  sections: readonly ActionTurnSection[],
  filter: ActionFilter,
): ActionTurnSection[] {
  if (filter === "all") return [...sections];
  const keep = (item: ActionItem): boolean => {
    if (filter === "threads") return item.kind === "thread";
    if (filter === "sessions") return item.kind === "spawn";
    if (filter === "worksets") return item.kind === "workset";
    return item.kind === "group";
  };
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(keep),
    }))
    .filter((section) => section.items.length > 0);
}

export function flattenActionItems(sections: readonly ActionTurnSection[]): ActionItem[] {
  return sections.flatMap((section) => section.items);
}

/** Origin key of the newest model turn, when that turn is still producing output. */
export function liveTurnOriginKey(
  turns: readonly TranscriptTurn[],
  live: boolean,
): string | null {
  if (!live) return null;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.kind === "model") return turnOriginKey(turn);
  }
  return null;
}

export function actionItemMatches(
  item: ActionItem,
  selectedGroupId: string | null,
  selectedThreadEpisode: string | null,
): boolean {
  if (item.kind === "thread") {
    return selectedThreadEpisode === item.episodeKey;
  }
  return selectedGroupId === item.id;
}
