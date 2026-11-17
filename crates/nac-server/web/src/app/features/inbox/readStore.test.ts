import { describe, expect, it } from "vitest";

import { createInboxReadStore } from "./readStore";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("inbox read store", () => {
  it("starts a new device at now and persists marks", () => {
    const storage = memory();
    const store = createInboxReadStore(storage, 1000);
    expect(store.getState()).toEqual({ since: 1000, runs: {} });
    store.markRead("a", "r1");
    store.markAllRead([
      { sessionId: "b", runId: "r2" },
      { sessionId: "a", runId: "r3" },
    ]);
    const again = createInboxReadStore(storage, 9999);
    expect(again.getState()).toEqual({ since: 1000, runs: { b: "r2", a: "r3" } });
  });

  it("survives blocked or corrupt storage", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const store = createInboxReadStore(throwing, 5);
    store.markRead("a", "r");
    expect(store.getState().runs).toEqual({ a: "r" });
    const corrupt = createInboxReadStore(memory({ "nac.inbox.read.v1": "{nope" }), 7);
    expect(corrupt.getState()).toEqual({ since: 7, runs: {} });
  });
});
