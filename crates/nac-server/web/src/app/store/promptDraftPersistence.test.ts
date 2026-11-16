import { describe, expect, it, vi } from "vitest";
import { createPromptDraftStore, type PromptDraftPersistenceBinding } from "./promptDraftStore";
import { createNativeRuntime, type NativeRuntimeScope } from "../runtime/nativeRuntime";
import { createNacClient } from "../services/nacClient";

const scope: NativeRuntimeScope = {
  owner: "serving-owner-a",
  profile: "standalone",
  organization: "serving-organization-a",
  host: "serving-host-a",
  incarnation: "serving-a",
  endpoint: "http://127.0.0.1:41001",
  release: "build-a",
};
const replacement: NativeRuntimeScope = {
  ...scope,
  owner: "serving-owner-b",
  organization: "serving-organization-b",
  host: "serving-host-b",
  incarnation: "serving-b",
  endpoint: "http://127.0.0.1:41002",
  release: "build-b",
};
const profile: PromptDraftPersistenceBinding = {
  owner: "local-user",
  profile: "profile-a",
  organization: "local",
  host: "local-machine",
  store: "canonical-store-a",
  track: "dev",
};
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

describe("explicit stable text persistence through the existing draft owner", () => {
  it("restores exact same-profile text after a new serving lifetime, port and release", () => {
    const adapter = storage();
    const first = createPromptDraftStore(scope, adapter, profile);
    first.update("a", "  !echo 雪\n\n/plan 🙂  ");
    first.update("b", "other session");
    first.release();
    const next = createPromptDraftStore(replacement, adapter, profile);
    expect(next.get("a").text).toBe("  !echo 雪\n\n/plan 🙂  ");
    expect(next.get("b").text).toBe("other session");
    expect(next.isSubmitting("a")).toBe(false);
  });

  it.each(Object.keys(profile) as (keyof PromptDraftPersistenceBinding)[])(
    "separates the durable %s identity even with equal session/runtime IDs",
    (field) => {
      const adapter = storage();
      createPromptDraftStore(scope, adapter, profile).update("a", "private");
      const other = { ...profile, [field]: "other" };
      expect(createPromptDraftStore(scope, adapter, other).get("a").text).toBe("");
    },
  );

  it("keeps default full-binding persistence separate in both directions", () => {
    const adapter = storage();
    createPromptDraftStore(scope, adapter).update("a", "ordinary tab");
    const desktop = createPromptDraftStore(scope, adapter, profile);
    expect(desktop.get("a").text).toBe("");
    desktop.update("a", "desktop text");
    expect(createPromptDraftStore(scope, adapter).get("a").text).toBe("ordinary tab");
    expect(createPromptDraftStore(replacement, adapter).get("a").text).toBe("");
  });

  it("serializes only versioned binding and exact text evidence, not runtime request state", () => {
    const adapter = storage();
    const drafts = createPromptDraftStore(scope, adapter, profile);
    drafts.update("a", "  !inert text  ");
    drafts.claimSubmission("a");
    drafts.claimCancellation("a");
    expect(JSON.parse([...adapter.values.values()][0])).toEqual({
      version: 2,
      binding: Object.values(profile),
      drafts: [["a", "  !inert text  "]],
    });
  });

  it("captures the durable binding independently of later caller mutations", () => {
    const adapter = storage();
    const mutable = { ...profile };
    const drafts = createPromptDraftStore(scope, adapter, mutable);
    mutable.store = "changed after construction";
    drafts.update("a", "original profile");
    expect(createPromptDraftStore(replacement, adapter, profile).get("a").text).toBe(
      "original profile",
    );
    expect(createPromptDraftStore(replacement, adapter, mutable).get("a").text).toBe("");
  });

  it.each([
    { name: "empty", value: "" },
    { name: "oversized", value: "x".repeat(4097) },
  ])("rejects an invalid $name stable identity", ({ value }) => {
    const adapter = storage();
    const drafts = createPromptDraftStore(scope, adapter, { ...profile, store: value });
    drafts.update("a", "memory remains usable");
    expect(drafts.get("a").text).toBe("memory remains usable");
    expect(adapter.getItem).not.toHaveBeenCalled();
    expect(adapter.setItem).not.toHaveBeenCalled();
    expect(drafts.acknowledge("a", drafts.get("a"))).toBe(true);
  });

  it("does not enable persistence without a complete live runtime or a supplied adapter", () => {
    const adapter = storage();
    const drafts = createPromptDraftStore(undefined, adapter, profile);
    drafts.update("a", "not an authority binding");
    expect(adapter.setItem).not.toHaveBeenCalled();
    const memory = createPromptDraftStore(scope, undefined, profile);
    memory.update("a", "memory only");
    expect(createPromptDraftStore(scope, undefined, profile).get("a").text).toBe("");
    const invalid = createPromptDraftStore({ ...scope, release: "" }, adapter, profile);
    invalid.update("a", "invalid live binding");
    expect(adapter.setItem).not.toHaveBeenCalled();
  });

  it("restores review text as uncertain without restoring pending requests or clearing newer edits", () => {
    const adapter = storage();
    const first = createPromptDraftStore(scope, adapter, profile);
    const submitted = first.update("a", "submitted text");
    const recovery = first.retainSubmission("a", submitted)!;
    first.claimSubmission("a");
    first.acknowledge("a", submitted);
    first.update("a", "same newer text");
    first.release();
    const next = createPromptDraftStore(replacement, adapter, profile);
    expect(next.getRecoveries("a")).toEqual([{ ...recovery, status: "uncertain" }]);
    expect(next.get("a").text).toBe("same newer text");
    expect(next.isSubmitting("a")).toBe(false);
    first.settleSubmission("a", recovery, "confirmed");
    first.update("a", "stale write");
    expect(next.getRecoveries("a")).toHaveLength(1);
    expect(createPromptDraftStore(replacement, adapter, profile).getRecoveries("a")).toEqual([
      { ...recovery, status: "uncertain" },
    ]);
    expect(next.restoreRecovery("a", next.getRecoveries("a")[0])).toBe(false);
    const sent = next.get("a");
    next.update("a", "same newer text");
    expect(next.acknowledge("a", sent)).toBe(false);
  });

  it("does not resurrect a cleared or purged draft through a closed owner", () => {
    const adapter = storage();
    const first = createPromptDraftStore(scope, adapter, profile);
    const sent = first.update("a", "A");
    first.update("b", "B");
    first.acknowledge("a", sent);
    first.release();
    first.update("a", "late");
    const next = createPromptDraftStore(replacement, adapter, profile);
    expect(next.get("a").text).toBe("");
    expect(next.get("b").text).toBe("B");
    next.purgeSessions(["b"]);
    expect(createPromptDraftStore(scope, adapter, profile).get("b").text).toBe("");
  });

  it("keeps typing and acknowledgement usable after corrupt or quota-failed persistence", () => {
    const adapter = storage();
    adapter.getItem.mockReturnValue("{broken");
    const drafts = createPromptDraftStore(scope, adapter, profile);
    adapter.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    drafts.update("a", "still usable");
    expect(drafts.get("a").text).toBe("still usable");
    expect(drafts.acknowledge("a", drafts.get("a"))).toBe(true);
    expect(adapter.removeItem).toHaveBeenCalled();
  });

  it("does not deserialize another profile's record even if the adapter returns the wrong key", () => {
    const adapter = storage();
    createPromptDraftStore(scope, adapter, profile).update("a", "private");
    const raw = [...adapter.values.values()][0];
    adapter.getItem.mockReturnValue(raw);
    const other = createPromptDraftStore(scope, adapter, { ...profile, track: "stable" });
    expect(other.get("a").text).toBe("");
  });

  it("rejects an oversized stored checkpoint without truncating an active in-memory prompt", () => {
    const adapter = storage();
    const drafts = createPromptDraftStore(scope, adapter, profile);
    const huge = "雪".repeat(1_000_001);
    drafts.update("a", huge);
    expect(drafts.get("a").text).toBe(huge);
    expect(createPromptDraftStore(scope, adapter, profile).get("a").text.length).toBe(0);
    expect(drafts.acknowledge("a", drafts.get("a"))).toBe(true);
  });

  it.each([
    { name: "version", change: { version: 1 } },
    {
      name: "duplicate draft",
      change: {
        drafts: [
          ["a", "first"],
          ["a", "second"],
        ],
      },
    },
    { name: "malformed draft", change: { drafts: [["a", { request: "never an intent" }]] } },
    { name: "oversized draft", change: { drafts: [["a", "x".repeat(1_000_001)]] } },
    { name: "oversized session ID", change: { drafts: [["x".repeat(4097), "text"]] } },
    { name: "recoveries shape", change: { recoveries: "wrong" } },
    { name: "recovery text shape", change: { recoveries: [["a", "r", { command: "no" }]] } },
    {
      name: "duplicate recovery ID",
      change: {
        recoveries: [
          ["a", "r", "first"],
          ["b", "r", "second"],
        ],
      },
    },
    {
      name: "combined retained characters",
      change: {
        drafts: [["a", "x".repeat(600_000)]],
        recoveries: [["b", "r", "y".repeat(600_000)]],
      },
    },
  ])("rejects a corrupt $name checkpoint and keeps the composer usable", ({ change }) => {
    const adapter = storage();
    adapter.getItem.mockReturnValue(
      JSON.stringify({
        version: 2,
        binding: Object.values(profile),
        drafts: [["a", "private"]],
        ...change,
      }),
    );
    const drafts = createPromptDraftStore(scope, adapter, profile);
    expect(drafts.get("a").text.length).toBe(0);
    expect(drafts.getRecoveries("a")).toEqual([]);
    drafts.update("a", "usable");
    expect(drafts.acknowledge("a", drafts.get("a"))).toBe(true);
  });

  it("bounds encoded checkpoint bytes before JSON parsing", () => {
    const adapter = storage();
    // Valid small draft data with an oversized unknown field still cannot reach decoding.
    adapter.getItem.mockReturnValue(
      JSON.stringify({
        version: 2,
        binding: Object.values(profile),
        drafts: [["a", "private"]],
        extra: "雪".repeat(1_400_000),
      }),
    );
    const drafts = createPromptDraftStore(scope, adapter, profile);
    expect(drafts.get("a").text.length).toBe(0);
    drafts.update("a", "usable");
    expect(drafts.get("a").text).toBe("usable");
  });

  it("restores only draft evidence through runtime options while retaining transport and query fences", () => {
    const adapter = storage();
    const fetch = vi.fn();
    const makeRuntime = (binding: NativeRuntimeScope) =>
      createNativeRuntime({
        scope: binding,
        client: createNacClient({ endpoint: binding.endpoint, credentials: "same-origin", fetch }),
        draftStorage: adapter,
        draftPersistenceBinding: profile,
      });
    const first = makeRuntime(scope);
    first.stores.promptDraftStore.update("a", "draft");
    first.queryClient.setQueryData(["a"], "private query");
    first.stores.composerStore.sendPrompt("pending executable intent");
    first.close();
    const next = makeRuntime(replacement);
    try {
      expect(next.stores.promptDraftStore.get("a").text).toBe("draft");
      expect(next.scope).toEqual(replacement);
      expect(next.queryClient.getQueryData(["a"])).toBeUndefined();
      expect(first.isClosed()).toBe(true);
      expect(first.stores.promptDraftStore.claimSubmission("a")).toBeNull();
      const consume = vi.fn();
      next.stores.composerStore.consumePromptRequests(consume);
      expect(consume).not.toHaveBeenCalled();
      expect([...adapter.values.values()].join("")).not.toContain("pending executable intent");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      next.close();
    }
  });
});

describe("native storage integration still required after U1", () => {
  it.todo("restores actual preferences across an OS-assigned port through a per-profile WK store");
  it.todo(
    "orders native queued writes, clear tombstones and successor hydration across retirement",
  );
  it.todo("qualifies primary recovery presentation in production-built browser and actual WK");
  it.todo(
    "qualifies actual renderer/engine replacement, dev/stable profiles and cross-Quit recovery",
  );
});
