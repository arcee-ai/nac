import { describe, expect, it, vi } from "vitest";
import { createPromptDraftStore, type PromptDraftStorage } from "./promptDraftStore";
import type { NativeRuntimeScope } from "../runtime/nativeRuntime";

const scope: NativeRuntimeScope = {
  owner: "owner",
  profile: "profile",
  organization: "organization",
  host: "host",
  incarnation: "incarnation",
  endpoint: "/api",
  release: "release",
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

describe("runtime primary prompt drafts", () => {
  it("restores exact independent text without serializing revisions or request state", () => {
    const adapter = storage();
    const first = createPromptDraftStore(scope, adapter);
    first.update("a", "  !echo 雪\n\n /plan 🙂  \n");
    first.update("b", "/compact");
    first.release();
    expect(first.get("a").text).toBe("");
    const next = createPromptDraftStore(scope, adapter);
    expect(next.get("a").text).toBe("  !echo 雪\n\n /plan 🙂  \n");
    expect(next.get("b").text).toBe("/compact");
    expect(JSON.parse([...adapter.values.values()][0])).toEqual({
      version: 1,
      binding: Object.values(scope),
      drafts: [
        ["a", "  !echo 雪\n\n /plan 🙂  \n"],
        ["b", "/compact"],
      ],
    });
  });

  it.each(Object.keys(scope) as (keyof NativeRuntimeScope)[])(
    "isolates the %s binding",
    (field) => {
      const adapter = storage();
      createPromptDraftStore(scope, adapter).update("same", "private text");
      expect(
        createPromptDraftStore({ ...scope, [field]: "different" }, adapter).get("same").text,
      ).toBe("");
      expect(createPromptDraftStore(scope, adapter).get("other").text).toBe("");
    },
  );

  it("keeps hosted drafts in memory without ambient storage or an incomplete binding", () => {
    const adapter = storage();
    const one = createPromptDraftStore();
    one.update("a", "memory");
    expect(one.get("a").text).toBe("memory");
    expect(createPromptDraftStore().get("a").text).toBe("");
    createPromptDraftStore(undefined, adapter).update("a", "unscoped");
    expect(adapter.setItem).not.toHaveBeenCalled();
  });

  it("acknowledges only the originating revision, including identical newer text", () => {
    const drafts = createPromptDraftStore();
    const sent = drafts.update("a", "same");
    drafts.update("b", "other session");
    drafts.update("a", "newer");
    const newer = drafts.update("a", "same");
    expect(newer.revision).toBeGreaterThan(sent.revision);
    expect(drafts.acknowledge("a", sent)).toBe(false);
    expect(drafts.get("a").text).toBe("same");
    expect(drafts.acknowledge("a", newer)).toBe(true);
    expect(drafts.get("b").text).toBe("other session");
  });

  it("clearing, scoped deletion and logout never resurrect text; release fences stale writes", () => {
    const adapter = storage();
    const drafts = createPromptDraftStore(scope, adapter);
    const sent = drafts.update("a", "submitted");
    drafts.update("a", "");
    expect(createPromptDraftStore(scope, adapter).get("a").text).toBe("");
    drafts.update("b", "keep");
    drafts.purgeSessions(["a"]);
    expect(drafts.acknowledge("a", sent)).toBe(false);
    expect(createPromptDraftStore(scope, adapter).get("b").text).toBe("keep");
    drafts.purgeAll();
    expect(adapter.values.size).toBe(0);
    drafts.release();
    drafts.update("a", "stale");
    expect(drafts.acknowledge("a", sent)).toBe(false);
    expect(adapter.values.size).toBe(0);
  });

  it.each(["{broken", '{"version":2}', '{"version":1,"binding":[],"drafts":[]}'])(
    "ignores malformed or incompatible persisted data %s",
    (raw) => {
      const adapter = storage();
      adapter.getItem.mockReturnValue(raw);
      const drafts = createPromptDraftStore(scope, adapter);
      expect(drafts.get("a").text).toBe("");
      drafts.update("a", "usable");
      expect(drafts.get("a").text).toBe("usable");
    },
  );

  it("survives denied storage and removes stale records after quota failure", () => {
    const adapter = storage();
    const drafts = createPromptDraftStore(scope, adapter);
    drafts.update("a", "old");
    adapter.setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    drafts.update("a", "new");
    expect(drafts.get("a").text).toBe("new");
    expect(adapter.values.size).toBe(0);
    const denied: PromptDraftStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const memory = createPromptDraftStore(scope, denied);
    memory.update("a", "typing still works");
    expect(memory.get("a").text).toBe("typing still works");
    expect(memory.acknowledge("a", memory.get("a"))).toBe(true);
  });

  it("bounds inactive retention while keeping an oversized active prompt verbatim", () => {
    const drafts = createPromptDraftStore();
    for (let i = 0; i < 101; i++) drafts.update(String(i), "small");
    expect(drafts.get("0").text).toBe("");
    const large = "雪".repeat(1_000_001);
    drafts.update("active", large);
    expect(drafts.get("active").text).toBe(large);
    expect(drafts.get("100").text).toBe("");
  });
});

it("owns transient submission claims across views and fences stale release callbacks", () => {
  const drafts = createPromptDraftStore();
  const finish = drafts.claimSubmission("a")!;
  expect(drafts.isSubmitting("a")).toBe(true);
  expect(drafts.claimSubmission("a")).toBeNull();
  const finishOther = drafts.claimSubmission("b")!;
  drafts.update("a", "newer text");
  expect(drafts.claimSubmission("a")).toBeNull();
  finish();
  expect(drafts.isSubmitting("a")).toBe(false);
  expect(drafts.isSubmitting("b")).toBe(true);
  const finishNext = drafts.claimSubmission("a")!;
  finish();
  expect(drafts.isSubmitting("a")).toBe(true);
  finishNext();
  finishOther();
  drafts.release();
  expect(drafts.claimSubmission("a")).toBeNull();
});

it("persists text without request claims and keeps stale claims away from a new lifetime", () => {
  const adapter = storage();
  const drafts = createPromptDraftStore(scope, adapter);
  const old = drafts.claimSubmission("a")!;
  drafts.update("a", "unsent text");
  const restored = createPromptDraftStore(scope, adapter);
  expect(restored.get("a").text).toBe("unsent text");
  expect(restored.isSubmitting("a")).toBe(false);
  const next = restored.claimSubmission("a")!;
  drafts.release();
  old();
  expect(restored.isSubmitting("a")).toBe(true);
  next();
});
