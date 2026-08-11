// Prompts the rest of the session screen asks the chat to send. Starting the
// run from a starter card itself would have to repeat everything the composer's
// submit does — slash commands, compaction, the optimistic bubble, the run
// events — so the card only names the prompt and the composer sends it.

import { createStore } from "@/app/lib/store";

interface ComposerState {
  /** Prompt waiting to be sent, or null once the composer has taken it. */
  pending: string | null;
}

const composerStore = createStore<ComposerState>({ pending: null }, "composer");

export function sendPrompt(pending: string): void {
  composerStore.setState({ pending });
}

/**
 * Hands each requested prompt to `send` exactly once. Returns the unsubscribe,
 * so an effect can `return consumePromptRequests(...)` directly.
 */
export function consumePromptRequests(
  send: (prompt: string) => void,
): () => void {
  return composerStore.subscribe(() => {
    const { pending } = composerStore.getState();
    if (pending === null) return;
    composerStore.setState({ pending: null });
    send(pending);
  });
}
