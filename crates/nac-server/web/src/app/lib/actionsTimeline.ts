import { partitionAgentTranscript, type AgentToolsGroup } from "@/app/lib/agentSegments";
import type {
  ThreadState,
  TranscriptBlock,
  TranscriptThread,
  TranscriptTurn,
  UserTurn,
} from "@/app/lib/transcript";

export type ActionFilter = "all" | "threads" | "tools" | "worksets";

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

export function actionFilterEmptyCopy(
  filter: ActionFilter,
  kind: "agent" | "orchestrator",
): { title: string; body: string } {
  switch (filter) {
    case "threads":
      return {
        title: "No threads yet.",
        body: "They appear here as the orchestrator assigns work.",
      };
    case "worksets":
      return {
        title: "No worksets yet.",
        body: "They appear here as the orchestrator defines them.",
      };
    case "tools":
      return {
        title: "No thoughts or tools yet.",
        body:
          kind === "orchestrator"
            ? "They appear here as the orchestrator works."
            : "They appear here as the agent works.",
      };
    default:
      return {
        title: "No actions yet.",
        body:
          kind === "orchestrator"
            ? "Start a conversation to create one."
            : "They appear here as the agent works.",
      };
  }
}

function worksetTitle(block: Extract<TranscriptBlock, { kind: "workset" }>): string {
  if (block.worksetId) return `Worksets_${block.worksetId}`;
  return block.pending ? "Defining worksets…" : "Worksets";
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

/** Keep a group with the nested thread rows that follow it while reversing units. */
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

  return units.reverse().flatMap((unit) => {
    const reversed = [...unit].reverse();
    return reversed.map((item, index) => {
      if (item.kind !== "thread" || !item.nested) return item;
      const parentAbove = reversed
        .slice(0, index)
        .some((candidate) => candidate.kind === "group" || candidate.kind === "workset");
      return parentAbove ? item : { ...item, nested: false };
    });
  });
}

function itemsFromModelTurn(turn: Extract<TranscriptTurn, { kind: "model" }>): ActionItem[] {
  const items: ActionItem[] = [];
  let nestThreads = false;
  for (const part of partitionAgentTranscript(turn)) {
    if (part.kind === "group") {
      items.push({ kind: "group", id: part.group.id, group: part.group });
      nestThreads = true;
      continue;
    }

    const block = part.block;
    if (block.kind === "workset") {
      items.push({
        kind: "workset",
        id: `${turn.key}:workset-${block.key}`,
        worksetId: block.worksetId,
        pending: block.pending,
        title: worksetTitle(block),
      });
      nestThreads = true;
      continue;
    }
    if (block.kind !== "wave") continue;
    for (const row of block.rows) {
      for (const thread of row) items.push(threadItem(thread, nestThreads));
    }
  }
  return newestFirstActionItems(items);
}

/** Project the existing transcript into newest-first, presentation-only action rows. */
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
    if (items.length > 0) {
      sections.push({
        key: turn.key,
        prompt: pendingUser?.text ?? "",
        createdAt: pendingUser?.createdAt ?? null,
        items,
      });
    }
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
    if (filter === "worksets") return item.kind === "workset";
    return item.kind === "group";
  };
  return sections
    .map((section) => ({ ...section, items: section.items.filter(keep) }))
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
  return item.kind === "thread"
    ? selectedThreadEpisode === item.episodeKey
    : selectedGroupId === item.id;
}
