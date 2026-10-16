import { useSyncExternalStore } from "react";
import type { NativeRuntimeScope } from "../runtime/nativeRuntime";

/** A caller-owned, tab-scoped adapter, separate from long-lived preferences. */
export type PromptDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface PromptDraft {
  readonly text: string;
  readonly revision: number;
}
const empty: PromptDraft = Object.freeze({ text: "", revision: 0 });
const maxDrafts = 100;
const maxRetainedCharacters = 1_000_000;
const fields = [
  "owner",
  "profile",
  "organization",
  "host",
  "incarnation",
  "endpoint",
  "release",
] as const;

/** Text only. Request bridges, shell intents and attachment payloads never enter this owner. */
export function createPromptDraftStore(scope?: NativeRuntimeScope, storage?: PromptDraftStorage) {
  const binding =
    scope && fields.every((field) => typeof scope[field] === "string")
      ? fields.map((field) => scope[field])
      : null;
  const key = binding ? `nac:prompt-drafts:v1:${JSON.stringify(binding)}` : null;
  const drafts = new Map<string, PromptDraft>();
  const listeners = new Set<() => void>();
  // In-memory request ownership survives view remounts, never a reload or runtime replacement.
  const submissions = new Map<string, object>();
  let revision = 0;
  let closed = false;

  // An invalid/partial consumer binding must never enable persistence.
  const persistent = key ? storage : undefined;
  try {
    const raw = key ? persistent?.getItem(key) : null;
    if (raw) {
      const saved = JSON.parse(raw);
      if (
        saved?.version === 1 &&
        JSON.stringify(saved.binding) === JSON.stringify(binding) &&
        Array.isArray(saved.drafts) &&
        saved.drafts.length <= maxDrafts &&
        saved.drafts.every(
          (entry: unknown) =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === "string" &&
            typeof entry[1] === "string",
        )
      ) {
        for (const [id, text] of saved.drafts as [string, string][]) {
          if (text) drafts.set(id, Object.freeze({ text, revision: ++revision }));
        }
      }
    }
  } catch {
    // Unavailable storage and malformed presentation data cannot disable the composer.
  }

  const notify = () => listeners.forEach((listener) => listener());
  const persist = () => {
    if (!persistent || !key) return;
    try {
      if (!drafts.size) persistent.removeItem(key);
      else
        persistent.setItem(
          key,
          JSON.stringify({
            version: 1,
            binding,
            drafts: [...drafts].map(([id, draft]) => [id, draft.text]),
          }),
        );
    } catch {
      // Do not leave an older persisted prompt to resurrect on the next reload.
      try {
        persistent.removeItem(key);
      } catch {
        /* Storage itself is unavailable. */
      }
    }
  };
  const get = (sessionId: string): PromptDraft => drafts.get(sessionId) ?? empty;
  const update = (sessionId: string, text: string): PromptDraft => {
    if (closed) return empty;
    const draft = Object.freeze({ text, revision: ++revision });
    drafts.delete(sessionId);
    // Retain empty revisions in memory: an old acknowledgement must not match a later edit.
    drafts.set(sessionId, draft);
    let characters = [...drafts.values()].reduce((total, item) => total + item.text.length, 0);
    for (const [id, item] of drafts) {
      if (drafts.size <= maxDrafts && characters <= maxRetainedCharacters) break;
      if (id === sessionId) continue;
      drafts.delete(id);
      characters -= item.text.length;
    }
    // The current prompt is never truncated, even when it alone exceeds the retention budget.
    persist();
    notify();
    return draft;
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get,
    update,
    subscribe,
    useDraft: (sessionId: string) =>
      useSyncExternalStore(
        subscribe,
        () => get(sessionId),
        () => get(sessionId),
      ),
    isSubmitting: (sessionId: string) => submissions.has(sessionId),
    useSubmitting: (sessionId: string) =>
      useSyncExternalStore(
        subscribe,
        () => submissions.has(sessionId),
        () => submissions.has(sessionId),
      ),
    /** One pending primary-composer operation per session, independent of its current view. */
    claimSubmission: (sessionId: string): (() => void) | null => {
      if (closed || submissions.has(sessionId)) return null;
      const claim = {};
      submissions.set(sessionId, claim);
      notify();
      return () => {
        if (closed || submissions.get(sessionId) !== claim) return;
        submissions.delete(sessionId);
        notify();
      };
    },
    acknowledge: (sessionId: string, submitted: PromptDraft): boolean => {
      if (closed || get(sessionId) !== submitted) return false;
      update(sessionId, "");
      return true;
    },
    /** Use on confirmed deletion or loss of access, never against a partial session list. */
    purgeSessions: (sessionIds: readonly string[]) => {
      if (closed) return;
      for (const id of sessionIds) {
        drafts.delete(id);
        submissions.delete(id);
      }
      persist();
      notify();
    },
    /** Hosts call before closing on logout/revocation; ordinary release preserves reload recovery. */
    purgeAll: () => {
      if (closed) return;
      drafts.clear();
      submissions.clear();
      persist();
      notify();
    },
    release: () => {
      closed = true;
      drafts.clear();
      submissions.clear();
      notify();
      listeners.clear();
    },
  };
}

// Compatibility fixtures remain ephemeral. Production supplies an explicit runtime.
export const {
  get,
  update,
  subscribe,
  useDraft,
  isSubmitting,
  useSubmitting,
  claimSubmission,
  acknowledge,
  purgeSessions,
  purgeAll,
  release,
} = createPromptDraftStore();
