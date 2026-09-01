import {
  partitionAgentTranscript,
  standaloneGroupFromBlock,
  type AgentToolsGroup,
} from "@/app/lib/agentSegments";
import type { ThreadState, TranscriptThread, TranscriptTurn, UserTurn } from "@/app/lib/transcript";

export type ActionFilter = "all" | "threads" | "tools" | "sessions";

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
  | { kind: "spawn"; id: string; group: AgentToolsGroup; title: string };

export interface ActionTurnSection {
  key: string;
  number: number;
  prompt: string;
  createdAt: string | null;
  items: ActionItem[];
}

function itemsFromModelTurn(turn: TranscriptTurn): ActionItem[] {
  if (turn.kind !== "model") return [];
  const items: ActionItem[] = [];
  let nestThreads = false;
  for (const part of partitionAgentTranscript(turn)) {
    if (part.kind === "group") {
      items.push({ kind: "group", id: part.group.id, group: part.group });
      nestThreads = true;
      continue;
    }
    const block = part.block;
    if (block.kind === "wave") {
      for (const row of block.rows) {
        for (const thread of row) {
          items.push(threadItem(thread, nestThreads));
        }
      }
      continue;
    }
    const spawn = standaloneGroupFromBlock(turn.key, block);
    if (spawn) {
      const lead = spawn.segments[0];
      const title =
        lead && lead.kind === "tool"
          ? (lead.presentation.summary ?? lead.presentation.label)
          : spawn.label;
      items.push({ kind: "spawn", id: spawn.id, group: spawn, title });
      nestThreads = false;
    }
  }
  return items;
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
 * Newest user turn first, with that turn's thoughts/tools, spawned sessions,
 * and thread dispatches in the order they happened.
 */
export function buildActionTimeline(turns: readonly TranscriptTurn[]): ActionTurnSection[] {
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
    const items = itemsFromModelTurn(turn);
    if (items.length === 0) {
      pendingUser = null;
      continue;
    }
    sections.push({
      key: turn.key,
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
