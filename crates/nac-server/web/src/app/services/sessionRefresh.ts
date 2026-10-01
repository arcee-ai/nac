interface SessionRefreshState {
  generation: number;
  replaceNextSnapshot: boolean;
  tailController: AbortController | null;
  historyControllers: Set<AbortController>;
}

export interface SnapshotFetchToken {
  generation: number;
  replace: boolean;
}

export interface TailFetchToken {
  generation: number;
  controller: AbortController;
}

const states = new Map<string, SessionRefreshState>();
// Tokens must never be reused after disposal, even when the same chat reopens.
let generationSequence = 0;
const owners = new WeakMap<object, number>();
let ownerSequence = 0;

/** Bind refresh state to its cache/endpoint lifetime without changing wire IDs. */
export function sessionRefreshKey(owner: object, sessionId: string): string {
  let identity = owners.get(owner);
  if (identity === undefined) {
    identity = ++ownerSequence;
    owners.set(owner, identity);
  }
  return `${identity}:${sessionId}`;
}

function stateFor(sessionId: string): SessionRefreshState {
  const existing = states.get(sessionId);
  if (existing) return existing;
  const created: SessionRefreshState = {
    generation: ++generationSequence,
    replaceNextSnapshot: false,
    tailController: null,
    historyControllers: new Set(),
  };
  states.set(sessionId, created);
  return created;
}

/** Fence every page read before a canonical snapshot is requested. */
export function fenceSessionSnapshot(sessionId: string, replace = false): number {
  const state = stateFor(sessionId);
  state.generation = ++generationSequence;
  state.replaceNextSnapshot ||= replace;
  state.tailController?.abort();
  state.tailController = null;
  for (const controller of state.historyControllers) controller.abort();
  state.historyControllers.clear();
  return state.generation;
}

/** Start a canonical fetch without consuming a destructive replacement. */
export function beginSnapshotFetch(sessionId: string): SnapshotFetchToken {
  const state = stateFor(sessionId);
  const generation = fenceSessionSnapshot(sessionId);
  return { generation, replace: state.replaceNextSnapshot };
}

/** Consume replacement state only after the matching snapshot was accepted. */
export function finishSnapshotFetch(sessionId: string, token: SnapshotFetchToken): void {
  const state = states.get(sessionId);
  if (state?.generation === token.generation && token.replace) {
    state.replaceNextSnapshot = false;
  }
}

export function beginTailFetch(sessionId: string): TailFetchToken {
  const state = stateFor(sessionId);
  state.tailController?.abort();
  const controller = new AbortController();
  state.tailController = controller;
  return { generation: state.generation, controller };
}

export function finishTailFetch(sessionId: string, token: TailFetchToken): void {
  const state = states.get(sessionId);
  if (state?.tailController === token.controller) state.tailController = null;
}

export function isCurrentSessionGeneration(sessionId: string, generation: number): boolean {
  return states.get(sessionId)?.generation === generation;
}

/** Historical pages share the canonical fence and release with their view. */
export function beginHistoryFetch(sessionId: string): TailFetchToken {
  const state = stateFor(sessionId);
  const controller = new AbortController();
  state.historyControllers.add(controller);
  return { generation: state.generation, controller };
}

export function finishHistoryFetch(sessionId: string, token: TailFetchToken): void {
  states.get(sessionId)?.historyControllers.delete(token.controller);
}

export function currentSessionGeneration(sessionId: string): number {
  return stateFor(sessionId).generation;
}

export function disposeSessionRefresh(sessionId: string): void {
  const state = states.get(sessionId);
  state?.tailController?.abort();
  for (const controller of state?.historyControllers ?? []) controller.abort();
  states.delete(sessionId);
}
