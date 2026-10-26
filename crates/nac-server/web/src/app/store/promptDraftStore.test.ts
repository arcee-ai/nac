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

describe("submitted prompt text recovery", () => {
  it("keeps local recovery IDs distinct after reload without secure-context crypto", () => {
    vi.stubGlobal("crypto", {});
    try {
      const adapter = storage();
      const first = createPromptDraftStore(scope, adapter);
      const original = first.retainSubmission("child", first.update("child", "A"))!;
      first.release();
      const next = createPromptDraftStore(scope, adapter);
      const second = next.retainSubmission("child", next.update("child", "B"))!;
      expect(second.id).not.toBe(original.id);
      expect(next.getRecoveries("child").map((entry) => entry.text)).toEqual(["A", "B"]);
      expect(next.restoreRecovery("child", second)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retains pending text on reload as uncertain alongside the newer draft without request claims", () => {
    const adapter = storage();
    const first = createPromptDraftStore(scope, adapter);
    const draft = first.update("child", "  original\nexact text  ");
    const recovery = first.retainSubmission("child", draft)!;
    first.acknowledge("child", draft);
    first.claimSubmission("child");
    first.update("child", "newer draft");
    first.release();
    const next = createPromptDraftStore(scope, adapter);
    expect(next.get("child").text).toBe("newer draft");
    expect(next.getRecoveries("child")).toEqual([{ ...recovery, status: "uncertain" }]);
    expect(next.isSubmitting("child")).toBe(false);
    expect(JSON.parse([...adapter.values.values()][0]).recoveries).toEqual([
      ["child", recovery.id, "  original\nexact text  "],
    ]);
    first.settleSubmission("child", recovery, "confirmed");
    expect(next.getRecoveries("child")).toHaveLength(1);
    expect(next.restoreRecovery("child", next.getRecoveries("child")[0])).toBe(false);
    expect(next.get("child").text).toBe("newer draft");
    next.update("child", "");
    expect(next.restoreRecovery("child", next.getRecoveries("child")[0])).toBe(true);
    expect(next.get("child").text).toBe("  original\nexact text  ");
    expect(next.getRecoveries("child")).toEqual([]);
  });

  it.each([true, false])(
    "settles concurrent messages independently in either order (reverse=%s)",
    (reverse) => {
      const drafts = createPromptDraftStore();
      const firstDraft = drafts.update("child", "A");
      const a = drafts.retainSubmission("child", firstDraft)!;
      drafts.acknowledge("child", firstDraft);
      const secondDraft = drafts.update("child", "B");
      const b = drafts.retainSubmission("child", secondDraft)!;
      drafts.acknowledge("child", secondDraft);
      drafts.update("child", "C");
      const confirmations = [
        () => drafts.settleSubmission("child", a, "confirmed"),
        () => drafts.settleSubmission("child", b, "not-sent"),
      ];
      for (const settle of reverse ? confirmations.reverse() : confirmations) settle();
      expect(drafts.get("child").text).toBe("C");
      expect(drafts.getRecoveries("child")).toEqual([{ ...b, status: "not-sent" }]);
      drafts.settleSubmission("child", b, "confirmed");
      expect(drafts.getRecoveries("child")).toHaveLength(1);
    },
  );

  it("fences deleted/replaced checkpoints and purges scoped evidence without resurrecting it", () => {
    const adapter = storage();
    const drafts = createPromptDraftStore(scope, adapter);
    const a = drafts.retainSubmission("child", drafts.update("child", "A"))!;
    drafts.purgeSessions(["child"]);
    drafts.settleSubmission("child", a, "uncertain");
    expect(drafts.getRecoveries("child")).toEqual([]);
    drafts.retainSubmission("child", drafts.update("child", "B"));
    expect(
      createPromptDraftStore({ ...scope, owner: "other" }, adapter).getRecoveries("child"),
    ).toEqual([]);
    drafts.purgeAll();
    expect(createPromptDraftStore(scope, adapter).getRecoveries("child")).toEqual([]);
  });

  it("refuses additional sends before losing text when retained recovery reaches its bound", () => {
    const drafts = createPromptDraftStore();
    for (let i = 0; i < 100; i++)
      drafts.retainSubmission("child", drafts.update("child", String(i)));
    const next = drafts.update("child", "keep this draft");
    expect(() => drafts.retainSubmission("child", next)).toThrow(
      "Unconfirmed message storage is full",
    );
    expect(drafts.get("child").text).toBe("keep this draft");
    expect(drafts.getRecoveries("child")).toHaveLength(100);
  });
});
