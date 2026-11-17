// Prompts the rest of the session screen asks the chat to send. Starting the
// run from a starter card itself would have to repeat everything the composer's
// submit does — slash commands, compaction, the optimistic bubble, the run
// events — so the card only names the prompt and the composer sends it.

import { createShellIntents } from "@/app/features/human-shell/intents";
import type { PromptDraft } from "./promptDraftStore";
import { createStore, standalonePreferenceStorage } from "@/app/lib/store";

interface ComposerState {
  /** Prompt waiting to be sent, or null once the composer has taken it. */
  pending: string | null;
  draft: { sessionId: string; text: string } | null;
  firstPrompt: { sessionId: string; draft: PromptDraft } | null;
}
/** One presentation lifetime; hosted preferences are ephemeral. */
export function createComposerStore(_storage?: Pick<Storage, "getItem" | "setItem">) {
  const composerStore = createStore<ComposerState>(
    { pending: null, draft: null, firstPrompt: null },
    "composer",
  );
  const initial_composerStore = composerStore.getState();
  const shellIntents = createShellIntents();
  let closed = false;

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
    const consume = () => {
      const { draft } = composerStore.getState();
      if (!draft || draft.sessionId !== sessionId) return;
      composerStore.setState({ draft: null });
      receive(draft.text);
    };
    const unsubscribe = composerStore.subscribe(consume);
    consume();
    return unsubscribe;
  }
  return {
    release: () => {
      closed = true;
      shellIntents.release();
      composerStore.setState(initial_composerStore);
    },
    shellIntents,
    scheduleFirstPrompt(sessionId: string, draft: PromptDraft) {
      if (closed) return;
      composerStore.setState({ firstPrompt: { sessionId, draft } });
    },
    useFirstPrompt: (sessionId: string) =>
      composerStore.useStore((state) =>
        state.firstPrompt?.sessionId === sessionId ? state.firstPrompt.draft : null,
      ),
    takeFirstPrompt(sessionId: string, draft: PromptDraft) {
      const pending = composerStore.getState().firstPrompt;
      if (closed || pending?.sessionId !== sessionId || pending.draft !== draft) return false;
      composerStore.setState({ firstPrompt: null });
      return true;
    },
    cancelFirstPrompt(sessionId: string) {
      if (composerStore.getState().firstPrompt?.sessionId === sessionId)
        composerStore.setState({ firstPrompt: null });
    },
    sendPrompt,
    consumePromptRequests,
    draftPrompt,
    consumeDraftRequests,
  };
}

export const {
  release,
  sendPrompt,
  consumePromptRequests,
  draftPrompt,
  consumeDraftRequests,
  shellIntents,
  scheduleFirstPrompt,
  useFirstPrompt,
  takeFirstPrompt,
  cancelFirstPrompt,
} = createComposerStore(standalonePreferenceStorage);
