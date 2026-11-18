import { createStore } from "@/app/lib/store";

export interface HomeDraft {
  text: string;
  revision: number;
  /** The project the text was last written for, so a later move can be shown. */
  projectId: string | null;
}

const EMPTY: Omit<HomeDraft, "revision"> = { text: "", projectId: null };

/** The unsent Home prompt belongs to one presentation, including return visits. */
export function createHomeDraftStore() {
  const store = createStore<HomeDraft>({ ...EMPTY, revision: 0 }, "home-draft");
  let closed = false;
  return {
    get: store.getState,
    usePrompt: () => store.useStore((state) => state.text),
    useProjectId: () => store.useStore((state) => state.projectId),
    update(text: string, projectId: string | null = store.getState().projectId) {
      if (!closed) store.setState({ text, projectId, revision: store.getState().revision + 1 });
    },
    acknowledge(revision: number) {
      if (!closed && store.getState().revision === revision)
        store.setState({ ...EMPTY, revision: revision + 1 });
    },
    release() {
      closed = true;
      store.setState({ ...EMPTY, revision: store.getState().revision + 1 });
    },
  };
}

export const standaloneHomeDraftStore = createHomeDraftStore();
