import { useSyncExternalStore } from "react";
import type { NativeRuntimeScope } from "../runtime/nativeRuntime";

/** Caller-owned text storage, separate from long-lived preferences. */
export type PromptDraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  /** Cold desktop bytes have no durable proof that an earlier clear succeeded. */
  readonly coldImports?: true;
};
/** Explicit durable text identity, never a replacement for NativeRuntimeScope.
 * The desktop caller derives these opaque values from its verified profile/store.
 * It also owns adapter lifetime, document fencing and durable write ordering.
 * Other callers retain full-runtime/tab scoping unless they opt in explicitly.
 */
export interface PromptDraftPersistenceBinding {
  readonly owner: string;
  readonly profile: string;
  readonly organization: string;
  readonly host: string;
  readonly store: string;
  readonly track: string;
}
export interface PromptDraft {
  readonly text: string;
  readonly revision: number;
}
export interface PromptRecovery {
  readonly id: string;
  readonly text: string;
  readonly status: "pending" | "not-sent" | "uncertain";
  readonly source?: "checkpoint";
}
interface DraftRow {
  readonly value: PromptDraft;
  readonly unreviewed: readonly PromptRecovery[];
  /** Runtime-only outcome token, never retained text or a durable receipt. */
  readonly unretainedSubmission?: object;
}
const noRecoveries: readonly PromptRecovery[] = Object.freeze([]);
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
const persistenceFields = ["owner", "profile", "organization", "host", "store", "track"] as const;
const maxIdentityLength = 4096;
const maxPersistedBytes = 4 * 1024 * 1024;
const validIdentity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maxIdentityLength;

/** Desktop checkpoints are bounded before parsing and before writing. The active
 * composer remains verbatim in memory even when it exceeds recovery retention.
 */
function boundedCheckpoint(drafts: unknown[], recoveries: unknown): boolean {
  if (recoveries !== undefined && !Array.isArray(recoveries)) return false;
  const savedRecoveries: unknown[] = recoveries ?? [];
  if (drafts.length > maxDrafts || savedRecoveries.length > maxDrafts) return false;
  let characters = 0;
  const sessions = new Set<string>();
  const recoveryIds = new Set<string>();
  for (const entry of drafts) {
    if (
      !Array.isArray(entry) ||
      (entry.length !== 2 && !(entry.length === 3 && entry[2] === "unreviewed")) ||
      !validIdentity(entry[0]) ||
      typeof entry[1] !== "string" ||
      (entry.length === 2 && sessions.has(entry[0]))
    )
      return false;
    if (entry.length === 2) sessions.add(entry[0]);
    characters += entry[1].length;
  }
  for (const entry of savedRecoveries) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 3 ||
      !validIdentity(entry[0]) ||
      !validIdentity(entry[1]) ||
      typeof entry[2] !== "string" ||
      recoveryIds.has(entry[1])
    )
      return false;
    recoveryIds.add(entry[1]);
    characters += entry[2].length;
  }
  return characters <= maxRetainedCharacters;
}

/** Text only. Request bridges, shell intents and attachment payloads never enter this owner. */
export function createPromptDraftStore(
  scope?: NativeRuntimeScope,
  storage?: PromptDraftStorage,
  persistenceBinding?: PromptDraftPersistenceBinding,
) {
  const runtimeBinding =
    scope && fields.every((field) => typeof scope[field] === "string")
      ? fields.map((field) => scope[field])
      : null;
  const stable = persistenceBinding !== undefined;
  const version = stable ? 2 : 1;
  const coldImports = stable && storage?.coldImports === true;
  const binding = stable
    ? runtimeBinding &&
      runtimeBinding.every(validIdentity) &&
      persistenceBinding &&
      persistenceFields.every((field) => validIdentity(persistenceBinding[field]))
      ? persistenceFields.map((field) => persistenceBinding[field])
      : null
    : runtimeBinding;
  // A distinct version/key prevents accidental import from ordinary browser tabs.
  const key = binding ? `nac:prompt-drafts:v${version}:${JSON.stringify(binding)}` : null;
  const drafts = new Map<string, DraftRow>();
  // Text checkpoints are recovery evidence, never commands to replay. Only the text/id
  // persist; an interrupted request is always uncertain in the next runtime.
  const recoveries = new Map<string, readonly PromptRecovery[]>();
  const listeners = new Set<() => void>();
  // In-memory request ownership survives view remounts, never a reload or runtime replacement.
  const submissions = new Map<string, Map<object, PromptDraft | undefined>>();
  const cancellations = new Map<string, object>();
  let revision = 0;
  let recoverySequence = 0;
  let closed = false;
  let retentionLimited = false;

  // An invalid/partial consumer binding must never enable persistence.
  const persistent = key ? storage : undefined;
  try {
    const raw = key ? persistent?.getItem(key) : null;
    if (
      raw &&
      (!stable ||
        (raw.length <= maxPersistedBytes &&
          new TextEncoder().encode(raw).length <= maxPersistedBytes))
    ) {
      const saved = JSON.parse(raw);
      if (
        saved?.version === version &&
        JSON.stringify(saved.binding) === JSON.stringify(binding) &&
        Array.isArray(saved.drafts) &&
        saved.drafts.length <= maxDrafts &&
        saved.drafts.every(
          (entry: unknown) =>
            Array.isArray(entry) &&
            (entry.length === 2 || (stable && entry.length === 3 && entry[2] === "unreviewed")) &&
            typeof entry[0] === "string" &&
            typeof entry[1] === "string",
        ) &&
        (!stable || boundedCheckpoint(saved.drafts, saved.recoveries))
      ) {
        for (const [id, text, trust] of saved.drafts as [string, string, string?][]) {
          if (!text) continue;
          const current = drafts.get(id);
          if (coldImports || trust === "unreviewed") {
            const review = Object.freeze({
              id: `checkpoint-${++recoverySequence}`,
              text,
              status: "uncertain" as const,
              source: "checkpoint" as const,
            });
            drafts.set(id, {
              value: current?.value ?? Object.freeze({ text: "", revision: ++revision }),
              unreviewed: Object.freeze([...(current?.unreviewed ?? []), review]),
            });
          } else {
            drafts.set(id, {
              value: Object.freeze({ text, revision: ++revision }),
              unreviewed: current?.unreviewed ?? noRecoveries,
            });
          }
        }
        if (Array.isArray(saved.recoveries)) {
          let retained = 0;
          let characters = 0;
          for (const entry of saved.recoveries) {
            if (
              !Array.isArray(entry) ||
              entry.length !== 3 ||
              !entry.every((value: unknown) => typeof value === "string")
            )
              continue;
            const [sessionId, id, text] = entry as [string, string, string];
            if (
              !text ||
              ++retained > maxDrafts ||
              (characters += text.length) > maxRetainedCharacters
            )
              break;
            recoveries.set(
              sessionId,
              Object.freeze([
                ...(recoveries.get(sessionId) ?? []),
                Object.freeze({ id, text, status: "uncertain" as const }),
              ]),
            );
          }
        }
      }
    }
  } catch {
    // Unavailable storage and malformed presentation data cannot disable the composer.
  }

  const notify = () => listeners.forEach((listener) => listener());
  const persist = () => {
    if (!persistent || !key) return;
    retentionLimited = false;
    try {
      if (!drafts.size && !recoveries.size) persistent.removeItem(key);
      else {
        const record = {
          version,
          binding,
          drafts: [...drafts].flatMap(([id, draft]) => [
            ...(draft.value.text || (!coldImports && !draft.unreviewed.length)
              ? [[id, draft.value.text]]
              : []),
            ...(draft.unreviewed ?? []).map((review) => [id, review.text, "unreviewed"]),
          ]),
          ...(recoveries.size
            ? {
                recoveries: [...recoveries].flatMap(([sessionId, entries]) =>
                  entries.map(({ id, text }) => [sessionId, id, text]),
                ),
              }
            : {}),
        };
        const raw = JSON.stringify(record);
        if (
          stable &&
          (!boundedCheckpoint(record.drafts, record.recoveries) ||
            new TextEncoder().encode(raw).length > maxPersistedBytes)
        ) {
          if (coldImports || [...drafts.values()].some((draft) => draft.unreviewed?.length)) {
            // Keep protected old evidence intact. New typing stays verbatim in
            // memory and the composer reports that it cannot yet be retained.
            retentionLimited = true;
            return;
          }
          throw new Error("Draft checkpoint exceeds its recovery retention bound.");
        }
        persistent.setItem(key, raw);
      }
    } catch {
      retentionLimited = true;
      // Do not leave an older persisted prompt to resurrect on the next reload.
      try {
        persistent.removeItem(key);
      } catch {
        /* Storage itself is unavailable. */
      }
    }
  };
  const get = (sessionId: string): PromptDraft => drafts.get(sessionId)?.value ?? empty;
  const getUnreviewed = (sessionId: string) => drafts.get(sessionId)?.unreviewed ?? noRecoveries;
  const update = (sessionId: string, text: string, reviewed?: PromptRecovery): PromptDraft => {
    if (closed) return empty;
    const previous = drafts.get(sessionId);
    const unreviewed = previous?.unreviewed.filter((entry) => entry !== reviewed);
    const draft = Object.freeze({ text, revision: ++revision });
    drafts.delete(sessionId);
    // Retain empty revisions in memory: an old acknowledgement must not match a later edit.
    drafts.set(sessionId, {
      ...previous,
      value: draft,
      unreviewed: unreviewed?.length ? Object.freeze(unreviewed) : noRecoveries,
    });
    let characters =
      [...drafts.values()].reduce(
        (total, item) =>
          total +
          item.value.text.length +
          (item.unreviewed ?? []).reduce((sum, review) => sum + review.text.length, 0),
        0,
      ) + [...recoveries.values()].flat().reduce((total, item) => total + item.text.length, 0);
    for (const [id, item] of drafts) {
      if (reviewed || (drafts.size <= maxDrafts && characters <= maxRetainedCharacters)) break;
      if (id === sessionId || item.unreviewed.length || submissions.has(id)) continue;
      drafts.delete(id);
      characters -= item.value.text.length;
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
  const getRecoveries = (sessionId: string) => recoveries.get(sessionId) ?? noRecoveries;
  const claimRequest = (claims: Map<string, object>, sessionId: string): (() => void) | null => {
    if (closed || claims.has(sessionId)) return null;
    const claim = {};
    claims.set(sessionId, claim);
    notify();
    return () => {
      if (closed || claims.get(sessionId) !== claim) return;
      claims.delete(sessionId);
      notify();
    };
  };
  const getUnretainedSubmission = (sessionId: string) =>
    drafts.get(sessionId)?.unretainedSubmission;
  const hasSubmission = (sessionId: string, submitted: PromptDraft) =>
    !closed && [...(submissions.get(sessionId)?.values() ?? [])].includes(submitted);
  const claimSubmission = (sessionId: string, submitted?: PromptDraft): (() => void) | null => {
    if (closed || (submitted && get(sessionId) !== submitted)) return null;
    const previous = submissions.get(sessionId);
    // Ordinary primary claims stay exclusive; running subagents can steer a
    // newer revision without dispatching the same captured revision twice.
    if (
      previous &&
      (!submitted || [...previous.values()].some((value) => !value || value === submitted))
    )
      return null;
    const claims = previous ?? new Map<object, PromptDraft | undefined>();
    const claim = {};
    claims.set(claim, submitted);
    submissions.set(sessionId, claims);
    notify();
    return () => {
      if (closed || submissions.get(sessionId) !== claims || !claims.delete(claim)) return;
      if (!claims.size) submissions.delete(sessionId);
      notify();
    };
  };
  const removeRecovery = (sessionId: string, recovery: PromptRecovery) => {
    if (closed) return;
    const draft = get(sessionId);
    if (getUnreviewed(sessionId).includes(recovery)) {
      drafts.set(sessionId, {
        ...drafts.get(sessionId)!,
        value: draft,
        unreviewed: Object.freeze(getUnreviewed(sessionId).filter((entry) => entry !== recovery)),
      });
      persist();
      notify();
      return;
    }
    const entries = getRecoveries(sessionId);
    // IDs survive persistence; object identity fences settlements against a replaced record.
    if (!entries.includes(recovery)) return;
    const next = entries.filter((entry) => entry !== recovery);
    if (next.length) recoveries.set(sessionId, Object.freeze(next));
    else recoveries.delete(sessionId);
    persist();
    notify();
  };
  return {
    get,
    update: (sessionId: string, text: string) => update(sessionId, text),
    subscribe,
    isRetentionLimited: () => retentionLimited,
    useRetentionLimited: () =>
      useSyncExternalStore(
        subscribe,
        () => retentionLimited,
        () => retentionLimited,
      ),
    useDraft: (sessionId: string) =>
      useSyncExternalStore(
        subscribe,
        () => get(sessionId),
        () => get(sessionId),
      ),
    getUnreviewed,
    useUnreviewed: (sessionId: string) =>
      useSyncExternalStore(
        subscribe,
        () => getUnreviewed(sessionId),
        () => getUnreviewed(sessionId),
      ),
    hasSubmission,
    getUnretainedSubmission,
    useUnretainedSubmission: (sessionId: string) =>
      useSyncExternalStore(
        subscribe,
        () => getUnretainedSubmission(sessionId),
        () => getUnretainedSubmission(sessionId),
      ),
    noteUnretainedSubmission: (sessionId: string, submitted: PromptDraft) => {
      const row = drafts.get(sessionId);
      if (!row || !hasSubmission(sessionId, submitted)) return;
      drafts.set(sessionId, { ...row, unretainedSubmission: Object.freeze({}) });
      notify();
    },
    dismissUnretainedSubmission: (sessionId: string, token: object) => {
      const row = drafts.get(sessionId);
      if (closed || !row || row.unretainedSubmission !== token) return;
      drafts.set(sessionId, { ...row, unretainedSubmission: undefined });
      notify();
    },
    getRecoveries,
    useRecoveries: (sessionId: string) =>
      useSyncExternalStore(
        subscribe,
        () => getRecoveries(sessionId),
        () => getRecoveries(sessionId),
      ),
    retainSubmission: (sessionId: string, submitted: PromptDraft): PromptRecovery | null => {
      if (closed || get(sessionId) !== submitted) return null;
      const entries = [...recoveries.values()].flat();
      const otherDraftCharacters = [...drafts].reduce(
        (sum, [id, draft]) =>
          sum +
          (id === sessionId ? 0 : draft.value.text.length) +
          (draft.unreviewed ?? []).reduce((total, review) => total + review.text.length, 0),
        0,
      );
      if (
        entries.length >= maxDrafts ||
        entries.reduce((sum, entry) => sum + entry.text.length, otherDraftCharacters) +
          submitted.text.length >
          maxRetainedCharacters
      )
        throw new Error(
          "Unconfirmed message storage is full. Resolve earlier messages before sending more.",
        );
      // These IDs identify local text, not server requests or authority. A
      // sequence also works on standalone HTTP, where randomUUID is unavailable.
      let id: string;
      do {
        id = `message-${++recoverySequence}`;
      } while (entries.some((entry) => entry.id === id));
      const recovery = Object.freeze({
        id,
        text: submitted.text,
        status: "pending" as const,
      });
      recoveries.set(sessionId, Object.freeze([...getRecoveries(sessionId), recovery]));
      persist();
      notify();
      return recovery;
    },
    settleSubmission: (
      sessionId: string,
      recovery: PromptRecovery,
      status: "confirmed" | "not-sent" | "uncertain",
    ) => {
      if (closed || !getRecoveries(sessionId).includes(recovery)) return;
      if (status === "confirmed") return removeRecovery(sessionId, recovery);
      recoveries.set(
        sessionId,
        Object.freeze(
          getRecoveries(sessionId).map((entry) =>
            entry === recovery ? Object.freeze({ ...entry, status }) : entry,
          ),
        ),
      );
      persist();
      notify();
    },
    dismissRecovery: (sessionId: string, recovery: PromptRecovery) => {
      if (recovery.status !== "pending") removeRecovery(sessionId, recovery);
    },
    restoreRecovery: (sessionId: string, recovery: PromptRecovery): boolean => {
      if (
        closed ||
        recovery.status === "pending" ||
        get(sessionId).text ||
        (!getRecoveries(sessionId).includes(recovery) &&
          !getUnreviewed(sessionId).includes(recovery))
      )
        return false;
      if (getUnreviewed(sessionId).includes(recovery)) {
        update(sessionId, recovery.text, recovery);
      } else {
        update(sessionId, recovery.text);
        removeRecovery(sessionId, recovery);
      }
      return true;
    },
    isSubmitting: (sessionId: string) => submissions.has(sessionId),
    useCancelling: (sessionId: string) =>
      useSyncExternalStore(
        subscribe,
        () => cancellations.has(sessionId),
        () => cancellations.has(sessionId),
      ),
    claimCancellation: (sessionId: string) => claimRequest(cancellations, sessionId),
    useSubmitting: (sessionId: string) =>
      useSyncExternalStore(
        subscribe,
        () => submissions.has(sessionId),
        () => submissions.has(sessionId),
      ),
    claimSubmission,
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
        cancellations.delete(id);
        recoveries.delete(id);
      }
      persist();
      notify();
    },
    /** Hosts call before closing on logout/revocation; ordinary release preserves reload recovery. */
    purgeAll: () => {
      if (closed) return;
      drafts.clear();
      submissions.clear();
      cancellations.clear();
      recoveries.clear();
      persist();
      notify();
    },
    release: () => {
      closed = true;
      drafts.clear();
      submissions.clear();
      cancellations.clear();
      recoveries.clear();
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
  getUnreviewed,
  useUnreviewed,
  isRetentionLimited,
  useRetentionLimited,
  hasSubmission,
  getUnretainedSubmission,
  useUnretainedSubmission,
  noteUnretainedSubmission,
  dismissUnretainedSubmission,
  getRecoveries,
  useRecoveries,
  retainSubmission,
  settleSubmission,
  dismissRecovery,
  restoreRecovery,
  isSubmitting,
  useCancelling,
  claimCancellation,
  useSubmitting,
  claimSubmission,
  acknowledge,
  purgeSessions,
  purgeAll,
  release,
} = createPromptDraftStore();
