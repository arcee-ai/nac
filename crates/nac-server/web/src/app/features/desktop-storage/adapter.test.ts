import { afterEach, describe, expect, it, vi } from "vitest";
import { createPromptDraftStore } from "../../store/promptDraftStore";
import { openDesktopStorage, safeStorage, type StorageDocument } from "./adapter";

const document: StorageDocument = { launch: "launch", view: "view", document: "document" };
const binding = {
  owner: "local",
  profile: "profile-a",
  organization: "local",
  host: "local",
  store: "store-a",
  track: "dev",
};
const endpoint = "http://127.0.0.1:41001";
function native() {
  let callback: (value: unknown) => void = () => {};
  const bootstrap = {
    version: 1,
    document,
    binding,
    endpoint,
    available: true,
    values: { preferences: {} as Record<string, string>, drafts: {} as Record<string, string> },
  };
  const messages: Record<string, unknown>[] = [];
  return {
    bootstrap,
    messages,
    open: vi.fn(async () => bootstrap),
    write: vi.fn((value: Record<string, unknown>) => {
      messages.push(value);
      return true;
    }),
    subscribe: vi.fn((next: typeof callback) => {
      callback = next;
      return () => {
        callback = () => {};
      };
    }),
    close: vi.fn(),
    ack: (sequence: number, durable = true, origin = document) =>
      callback({ document: origin, sequence, durable }),
  };
}
afterEach(() => {
  vi.useRealTimers();
});

describe("desktop presentation storage adapter", () => {
  it("preserves ordinary callers and catches storage acquisition and operation failures", async () => {
    expect(await openDesktopStorage(undefined, endpoint)).toBeUndefined();
    const forbidden = Object.defineProperty({}, "localStorage", {
      get() {
        throw new Error("denied");
      },
    });
    expect(safeStorage(forbidden, "localStorage")).toBeUndefined();
    const value = { getItem: vi.fn(() => "owned"), setItem: vi.fn(), removeItem: vi.fn() };
    expect(safeStorage({ sessionStorage: value }, "sessionStorage")?.getItem("key")).toBe("owned");
  });

  it("hydrates preferences and the actual336 owner before use without restoring intent", async () => {
    const port = native();
    const saved = new Map<string, string>();
    const writer = createPromptDraftStore(
      {
        owner: "o",
        profile: "p",
        organization: "o",
        host: "h",
        incarnation: "old",
        endpoint,
        release: "old",
      },
      {
        getItem: (key) => saved.get(key) ?? null,
        setItem: (key, value) => {
          saved.set(key, value);
        },
        removeItem: (key) => {
          saved.delete(key);
        },
      },
      binding,
    );
    writer.update("a", "  !inert 雪\n/plan 🙂 ");
    writer.claimSubmission("a");
    port.bootstrap.values.drafts = Object.fromEntries(saved);
    port.bootstrap.values.preferences["nac.sidebar.open"] = "1";
    const storage = (await openDesktopStorage(port, endpoint))!;
    const next = createPromptDraftStore(
      {
        owner: "new",
        profile: "p",
        organization: "new",
        host: "new",
        incarnation: "new",
        endpoint: "http://127.0.0.1:41002",
        release: "new",
      },
      storage.drafts,
      storage.binding,
    );
    expect(next.get("a").text).toBe("");
    expect(next.getUnreviewed("a")[0].text).toBe("  !inert 雪\n/plan 🙂 ");
    expect(storage.preferences.coldImports).toBeUndefined();
    expect(next.isSubmitting("a")).toBe(false);
    expect(storage.preferences.getItem("nac.sidebar.open")).toBe("1");
    expect(port.write).not.toHaveBeenCalled();
    storage.close();
  });

  it("orders write/clear/new edit and waits for the matching native flush acknowledgement", async () => {
    const port = native();
    const storage = (await openDesktopStorage(port, endpoint))!;
    storage.preferences.setItem("nac.chatTabs", "old");
    storage.preferences.removeItem("nac.chatTabs");
    storage.preferences.setItem("nac.chatTabs", "new");
    const flushed = storage.flush();
    expect(port.messages.map((value) => [value.sequence, value.kind, value.value])).toEqual([
      [1, "write", "old"],
      [2, "write", null],
      [3, "write", "new"],
      [4, "flush", undefined],
    ]);
    expect(storage.status()).toBe("pending");
    port.ack(1);
    port.ack(2);
    port.ack(3);
    let settled = false;
    void flushed.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    port.ack(4);
    expect(await flushed).toBe(true);
    expect(storage.preferences.getItem("nac.chatTabs")).toBe("new");
    expect(storage.status()).toBe("ready");
    storage.close();
    storage.preferences.setItem("nac.chatTabs", "late old-owner write");
    expect(port.messages).toHaveLength(4);
  });

  it("ignores stale document, future and repeated acknowledgements", async () => {
    const port = native();
    const storage = (await openDesktopStorage(port, endpoint))!;
    const flushed = storage.flush();
    port.ack(1, true, { ...document, document: "retired" });
    port.ack(2);
    expect(storage.status()).toBe("pending");
    port.ack(1);
    expect(await flushed).toBe(true);
    port.ack(1, false);
    expect(storage.status()).toBe("ready");
    storage.close();
  });

  it("keeps typing/sending usable after quota or native write failure without claiming durability", async () => {
    const port = native();
    const storage = (await openDesktopStorage(port, endpoint))!;
    const scope = {
      owner: "o",
      profile: "p",
      organization: "o",
      host: "h",
      incarnation: "i",
      endpoint,
      release: "r",
    };
    const drafts = createPromptDraftStore(scope, storage.drafts, storage.binding);
    drafts.update("a", "before error");
    port.ack(1, false);
    expect(storage.status()).toBe("unavailable");
    drafts.update("a", "still typing");
    expect(drafts.get("a").text).toBe("still typing");
    expect(drafts.acknowledge("a", drafts.get("a"))).toBe(true);
    expect(await storage.flush()).toBe(false);
    storage.close();
  });

  it.each(["wrong endpoint", "invalid profile", "unknown preference", "wrong draft namespace"])(
    "uses isolated memory instead of ambient storage for %s",
    async (kind) => {
      const port = native();
      if (kind === "wrong endpoint") port.bootstrap.endpoint = "http://127.0.0.1:49999";
      if (kind === "invalid profile") port.bootstrap.binding = { ...binding, store: "" };
      if (kind === "unknown preference")
        port.bootstrap.values.preferences["credentials"] = "must not import";
      if (kind === "wrong draft namespace")
        port.bootstrap.values.drafts["nac:prompt-drafts:v1:[]"] = "wrong";
      const storage = (await openDesktopStorage(port, endpoint))!;
      expect(storage.status()).toBe("unavailable");
      expect(storage.binding).toBeUndefined();
      expect(storage.preferences.getItem("credentials")).toBeNull();
      storage.preferences.setItem("nac.sidebar.open", "1");
      expect(storage.preferences.getItem("nac.sidebar.open")).toBe("1");
      expect(port.write).not.toHaveBeenCalled();
      storage.close();
    },
  );

  it("times out a missing bootstrap and an unacknowledged flush without replay", async () => {
    vi.useFakeTimers();
    const missing = native();
    missing.open.mockImplementation(() => new Promise(() => {}));
    const pending = openDesktopStorage(missing, endpoint, 20);
    await vi.advanceTimersByTimeAsync(20);
    const fallback = (await pending)!;
    expect(fallback.status()).toBe("unavailable");
    fallback.close();
    const port = native();
    const storage = (await openDesktopStorage(port, endpoint, 20))!;
    const flushed = storage.flush();
    await vi.advanceTimersByTimeAsync(20);
    expect(await flushed).toBe(false);
    expect(port.messages).toHaveLength(1);
    storage.close();
  });

  it("reports an unacknowledged ordinary checkpoint without requiring another user operation", async () => {
    vi.useFakeTimers();
    const port = native();
    const storage = (await openDesktopStorage(port, endpoint, 20))!;
    storage.preferences.setItem("nac.sidebar.open", "1");
    await vi.advanceTimersByTimeAsync(20);
    expect(storage.status()).toBe("unavailable");
    expect(storage.preferences.getItem("nac.sidebar.open")).toBe("1");
    expect(port.messages).toHaveLength(1);
    storage.close();
  });
});
