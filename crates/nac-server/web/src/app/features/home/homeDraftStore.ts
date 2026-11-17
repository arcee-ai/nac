import { createStore } from "@/app/lib/store";

/** The unsent Home prompt belongs to one presentation, including return visits. */
export function createHomeDraftStore() {
  const store = createStore({ text: "", revision: 0 }, "home-draft");
  let closed = false;
  return {
    get: store.getState,
    usePrompt: () => store.useStore((state) => state.text),
    update(text: string) {
      if (!closed) store.setState({ text, revision: store.getState().revision + 1 });
    },
    acknowledge(revision: number) {
      if (!closed && store.getState().revision === revision)
        store.setState({ text: "", revision: revision + 1 });
    },
    release() {
      closed = true;
      store.setState({ text: "", revision: store.getState().revision + 1 });
    },
  };
}

export const standaloneHomeDraftStore = createHomeDraftStore();
