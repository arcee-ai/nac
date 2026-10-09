// Prompts the rest of the session screen asks the chat to send. Starting the
// run from a starter card itself would have to repeat everything the composer's
// submit does — slash commands, compaction, the optimistic bubble, the run
// events — so the card only names the prompt and the composer sends it.

import { createStore } from "@/app/lib/store";

interface ComposerState {
  /** Prompt waiting to be sent, or null once the composer has taken it. */
  pending: string | null;
  /** Text to place in the field for the user to edit and send themselves. */
  draft: string | null;
}

const composerStore = createStore<ComposerState>({ pending: null, draft: null }, "composer");

export function sendPrompt(pending: string): void {
  composerStore.setState({ pending });
}

/**
 * Hands each requested prompt to `send` exactly once. Returns the unsubscribe,
 * so an effect can `return consumePromptRequests(...)` directly.
 */
export function consumePromptRequests(send: (prompt: string) => void): () => void {
  return composerStore.subscribe(() => {
    const { pending } = composerStore.getState();
    if (pending === null) return;
    composerStore.setState({ pending: null });
    send(pending);
  });
}

export function draftPrompt(draft: string): void {
  composerStore.setState({ draft });
}

/** Hands each requested draft to `fill` exactly once without sending it. */
export function consumeDraftRequests(fill: (draft: string) => void): () => void {
  return composerStore.subscribe(() => {
    const { draft } = composerStore.getState();
    if (draft === null) return;
    composerStore.setState({ draft: null });
    fill(draft);
  });
}
