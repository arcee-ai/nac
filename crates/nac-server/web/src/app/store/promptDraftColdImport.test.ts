/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createPromptDraftStore, type PromptDraftStorage } from "./promptDraftStore";
import { openDesktopStorage } from "../features/desktop-storage/adapter";

// The allocated non-GUI Swift episode supplies real owner snapshots. No mock
// disk failure stands in for that episode; ordinary runs explicitly skip it.
const episode = process.env.NAC_A0_EPISODE;
describe.skipIf(!episode)("actual native dual-fault checkpoint imported by the text owner", () => {
  it.each(["same-fault", "restored"])("handles the %s fresh owner", async (phase) => {
    const facts = JSON.parse(readFileSync(`${episode}/${phase}.json`, "utf8"));
    expect(facts.snapshot.available).toBe(true);
    const endpoint = "http://127.0.0.1:41001";
    const adapter = await openDesktopStorage(
      {
        open: async () => ({
          version: 1,
          endpoint,
          document: { launch: "fixture", view: "fixture", document: phase },
          binding: facts.binding,
          ...facts.snapshot,
        }),
        write: () => true,
        subscribe: () => () => {},
        close: () => {},
      },
      endpoint,
    );
    expect(adapter?.status()).toBe("ready");
    const store = createPromptDraftStore(
      {
        owner: "fixture",
        profile: "standalone",
        organization: "fixture",
        host: "fixture",
        incarnation: phase,
        endpoint,
        release: "fixture",
      },
      adapter!.drafts,
      adapter!.binding,
    );
    if (process.env.NAC_A0_EXPECT === "baseline") {
      expect(store.get("session").text).toBe("already-accepted-or-cleared-A");
      expect(store.getRecoveries("session")).toEqual([]);
    } else {
      expect(store.get("session").text).toBe("");
      expect(store.getUnreviewed("session")[0].text).toBe("already-accepted-or-cleared-A");
    }
    store.release();
    adapter!.close();
  });
});

const scope = {
  owner: "runtime",
  profile: "standalone",
  organization: "local",
  host: "local",
  incarnation: "serving-a",
  endpoint: "http://127.0.0.1:41001",
  release: "test",
};
const binding = {
  owner: "user",
  profile: "profile",
  organization: "local",
  host: "local",
  store: "store",
  track: "dev",
};
const key = `nac:prompt-drafts:v2:${JSON.stringify(Object.values(binding))}`;
function fixture(
  drafts: unknown[] = [["a", "  already sent 雪\n!inert 🙂  "]],
  recoveries: unknown[] = [],
) {
  const values = new Map([
    [key, JSON.stringify({ version: 2, binding: Object.values(binding), drafts, recoveries })],
  ]);
  const storage: PromptDraftStorage = {
    coldImports: true,
    getItem: (key) => values.get(key) ?? null,
    setItem: vi.fn((key, text) => {
      values.set(key, text);
    }),
    removeItem: vi.fn((key) => {
      values.delete(key);
    }),
  };
  return { values, storage, open: () => createPromptDraftStore(scope, storage, binding) };
}

describe("cold text review in the existing bounded draft owner", () => {
  it("keeps exact imported text behind review while new typing and sends retain their own revisions", () => {
    const f = fixture();
    const store = f.open();
    const review = store.getUnreviewed("a")[0];
    expect(review).toMatchObject({
      text: "  already sent 雪\n!inert 🙂  ",
      status: "uncertain",
      source: "checkpoint",
    });
    expect(store.get("a").text).toBe("");
    const sent = store.update("a", "new input");
    const submission = store.retainSubmission("a", sent)!;
    expect(store.restoreRecovery("a", review)).toBe(false);
    store.dismissRecovery("a", review);
    // Reviewing unrelated old text cannot replace the live draft's identity.
    expect(store.get("a")).toBe(sent);
    expect(store.acknowledge("a", sent)).toBe(true);
    store.settleSubmission("a", submission, "confirmed");
    expect(store.get("a").text).toBe("");
    const old = store.update("a", "identical");
    store.update("a", "identical");
    expect(store.acknowledge("a", old)).toBe(false);
    expect(store.get("a").text).toBe("identical");
  });

  it("restores only on explicit review and persists uncertainty through hot replacements", () => {
    const f = fixture();
    const first = f.open();
    first.update("a", "fresh text");
    first.release();
    const hot = createPromptDraftStore(scope, { ...f.storage, coldImports: undefined }, binding);
    expect(hot.get("a").text).toBe("fresh text");
    expect(hot.getUnreviewed("a")[0].text).toBe("  already sent 雪\n!inert 🙂  ");
    hot.update("a", "");
    const review = hot.getUnreviewed("a")[0];
    expect(hot.restoreRecovery("a", review)).toBe(true);
    expect(hot.getUnreviewed("a")).toEqual([]);
    expect(hot.get("a").text).toBe(review.text);
    hot.release();
    expect(hot.restoreRecovery("a", review)).toBe(false);
    // A new cold owner still cannot prove a later clear or accepted send was durable.
    expect(f.open().get("a").text).toBe("");
    expect(f.open().getUnreviewed("a")[0].text).toBe(review.text);
  });

  it.each(["dismiss", "restore"])("keeps failed %s disposition uncertain on restart", (action) => {
    const f = fixture();
    const before = f.values.get(key);
    const store = f.open();
    const review = store.getUnreviewed("a")[0];
    vi.mocked(f.storage.setItem).mockImplementation(() => {
      throw new Error("write denied");
    });
    vi.mocked(f.storage.removeItem).mockImplementation(() => {
      throw new Error("unlink denied");
    });
    if (action === "dismiss") store.dismissRecovery("a", review);
    else expect(store.restoreRecovery("a", review)).toBe(true);
    expect(store.isRetentionLimited()).toBe(true);
    expect(f.values.get(key)).toBe(before);
    store.release();
    expect(f.open().get("a").text).toBe("");
    expect(f.open().getUnreviewed("a")[0].text).toBe(review.text);
  });

  it("retains multiple cold texts for one session without joining, truncating or reclassifying them as submissions", () => {
    const f = fixture([["a", "old"]]);
    const first = f.open();
    first.update("a", "new");
    const next = f.open();
    expect(next.getUnreviewed("a").map((r) => r.text)).toEqual(["new", "old"]);
    expect(next.getRecoveries("a")).toEqual([]);
    next.update("a", "latest");
    expect(JSON.parse(f.values.get(key)!).drafts).toEqual([
      ["a", "latest"],
      ["a", "new", "unreviewed"],
      ["a", "old", "unreviewed"],
    ]);
  });

  it("preserves 100 imported drafts plus 100 submission recoveries and reports a 101st live draft as memory-only", () => {
    const f = fixture(
      Array.from({ length: 100 }, (_, i) => [`d${i}`, `draft-${i}`]),
      Array.from({ length: 100 }, (_, i) => [`r${i}`, `message-${i}`, `recovery-${i}`]),
    );
    const before = f.values.get(key);
    const store = f.open();
    const fresh = store.update("fresh", "new typing");
    expect(store.get("fresh")).toBe(fresh);
    expect(store.isRetentionLimited()).toBe(true);
    expect(f.values.get(key)).toBe(before);
    expect(f.storage.removeItem).not.toHaveBeenCalled();
    for (let i = 0; i < 100; i++) {
      expect(store.getUnreviewed(`d${i}`)[0].text).toBe(`draft-${i}`);
      expect(store.getRecoveries(`r${i}`)[0].text).toBe(`recovery-${i}`);
    }
    store.dismissRecovery("d0", store.getUnreviewed("d0")[0]);
    expect(store.get("fresh")).toBe(fresh);
    expect(store.isRetentionLimited()).toBe(false);
    const saved = JSON.parse(f.values.get(key)!);
    expect(saved.drafts).toHaveLength(100);
    expect(saved.recoveries).toHaveLength(100);
  });

  it.each([
    { name: "UTF16", text: "x".repeat(1_000_000) },
    { name: "encoded bytes", text: "\u0000".repeat(700_000) },
  ])("preserves protected text and verbatim new input at the $name limit", ({ text }) => {
    const f = fixture([["a", "old"]]);
    const before = f.values.get(key);
    const store = f.open();
    store.update("a", text);
    expect(store.get("a").text).toBe(text);
    expect(store.getUnreviewed("a")[0].text).toBe("old");
    expect(store.isRetentionLimited()).toBe(true);
    expect(f.values.get(key)).toBe(before);
    expect(f.storage.removeItem).not.toHaveBeenCalled();
  });

  it("rejects malformed review metadata while preserving ordinary browser and hosted defaults", () => {
    const invalid = fixture([["a", "text", "trusted"]]);
    expect(invalid.open().getUnreviewed("a")).toEqual([]);
    const f = fixture();
    const ordinary = createPromptDraftStore(
      scope,
      { ...f.storage, coldImports: undefined },
      binding,
    );
    expect(ordinary.get("a").text).toBe("  already sent 雪\n!inert 🙂  ");
    expect(ordinary.getUnreviewed("a")).toEqual([]);
    const hosted = createPromptDraftStore();
    const live = hosted.update("a", "normal");
    expect(hosted.acknowledge("a", live)).toBe(true);
  });
});
