// Prompts the rest of the session screen asks the chat to send. Starting the
// run from a starter card itself would have to repeat everything the composer's
// submit does — slash commands, compaction, the optimistic bubble, the run
// events — so the card only names the prompt and the composer sends it.

import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

interface ComposerState {
  /** Prompt waiting to be sent, or null once the composer has taken it. */
  pending: string | null;
  draft: { sessionId: string; text: string } | null;
}
/** One presentation lifetime; hosted preferences are ephemeral. */
export function createComposerStore(_storage?: Pick<Storage, "getItem" | "setItem">) {
  const composerStore = createStore<ComposerState>({ pending: null, draft: null }, "composer");
  const initial_composerStore = composerStore.getState();

  function sendPrompt(pending: string): void {
    composerStore.setState({ pending });
  }

  /**
   * Hands each requested prompt to `send` exactly once. Returns the unsubscribe,
   * so an effect can `return consumePromptRequests(...)` directly.
   */
  function consumePromptRequests(send: (prompt: string) => void): () => void {
    return composerStore.subscribe(() => {
      const { pending } = composerStore.getState();
      if (pending === null) return;
      composerStore.setState({ pending: null });
      send(pending);
    });
  }
  function draftPrompt(sessionId: string, text: string): void {
    composerStore.setState({ draft: { sessionId, text } });
  }
  function consumeDraftRequests(sessionId: string, receive: (text: string) => void): () => void {
    return composerStore.subscribe(() => {
      const { draft } = composerStore.getState();
      if (!draft || draft.sessionId !== sessionId) return;
      composerStore.setState({ draft: null });
      receive(draft.text);
    });
  }
  return {
    release: () => {
      composerStore.setState(initial_composerStore);
    },
    sendPrompt,
    consumePromptRequests,
    draftPrompt,
    consumeDraftRequests,
  };
}

export const { release, sendPrompt, consumePromptRequests, draftPrompt, consumeDraftRequests } = createComposerStore(
  standalonePreferenceStorage,
);
