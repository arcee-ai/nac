import * as AtomRegistry from "effect/reactivity/AtomRegistry";

/**
 * Yields atom bookkeeping to a microtask. Listeners still run inside `notify`.
 * Running this synchronously deletes a node inside `createNode`, before its
 * subscriber is attached, so the loader never restarts on the next mount.
 */
function scheduleTask(run: () => void): () => void {
  queueMicrotask(run);
  return () => {};
}

/**
 * The page's atom registry. React hooks and module-level readers share it, so a
 * preference written outside a component is the one the next render sees.
 * `RegistryProvider` builds a second registry and would split those two.
 */
export const appAtomRegistry = AtomRegistry.make({ scheduleTask });
