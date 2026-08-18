interface SessionRefreshState {
  generation: number;
  replaceNextSnapshot: boolean;
  tailController: AbortController | null;
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

function stateFor(sessionId: string): SessionRefreshState {
  const existing = states.get(sessionId);
  if (existing) return existing;
  const created: SessionRefreshState = {
    generation: 0,
    replaceNextSnapshot: false,
    tailController: null,
  };
  states.set(sessionId, created);
  return created;
}

/** Fence every page read before a canonical snapshot is requested. */
export function fenceSessionSnapshot(sessionId: string, replace = false): number {
  const state = stateFor(sessionId);
  state.generation += 1;
  state.replaceNextSnapshot ||= replace;
  state.tailController?.abort();
  state.tailController = null;
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

export function currentSessionGeneration(sessionId: string): number {
  return stateFor(sessionId).generation;
}

export function disposeSessionRefresh(sessionId: string): void {
  const state = states.get(sessionId);
  state?.tailController?.abort();
  states.delete(sessionId);
}
