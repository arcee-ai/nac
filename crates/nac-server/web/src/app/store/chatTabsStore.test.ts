/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatTabsStore, createChatTabsStore, setChatTabOrder } from "@/app/store/chatTabsStore";

beforeEach(() => {
  chatTabsStore.setState({ dismissed: new Set(), order: {} });
});

describe("project tab arrangement", () => {
  it("keeps each project's Option A order independent", () => {
    setChatTabOrder("project-a", ["a-2", "a-1"]);
    setChatTabOrder("project-b", ["b-3", "b-1", "b-2"]);

    expect(chatTabsStore.getState().order).toEqual({
      "project-a": ["a-2", "a-1"],
      "project-b": ["b-3", "b-1", "b-2"],
    });
  });

  it("preserves latest preferences on release and fences writes from a retired owner", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const first = createChatTabsStore(storage);
    first.dismissChatTab("session-a");
    first.setChatTabOrder("project-a", ["session-b", "session-a"]);
    const saved = values.get("nac.chatTabs");
    storage.setItem.mockClear();

    first.release();
    expect(first.chatTabsStore.getState()).toEqual({ dismissed: new Set(), order: {} });
    expect(values.get("nac.chatTabs")).toBe(saved);
    expect(storage.setItem).not.toHaveBeenCalled();

    const next = createChatTabsStore(storage);
    expect(next.chatTabsStore.getState()).toEqual({
      dismissed: new Set(["session-a"]),
      order: { "project-a": ["session-b", "session-a"] },
    });
    next.restoreChatTab("session-a");
    next.setChatTabOrder("project-a", ["session-a", "session-b"]);
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    const current = values.get("nac.chatTabs");
    expect(JSON.parse(current!)).toEqual({
      dismissed: [],
      order: { "project-a": ["session-a", "session-b"] },
    });
    storage.setItem.mockClear();

    first.dismissChatTab("stale-session");
    first.setChatTabOrder("stale-project", ["stale-session"]);
    first.release();
    first.release();
    expect(values.get("nac.chatTabs")).toBe(current);
    expect(storage.setItem).not.toHaveBeenCalled();
    next.release();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("keeps live in-memory preferences usable when storage is unavailable", () => {
    const denied = () => {
      throw new Error("storage unavailable");
    };
    const storage = { getItem: denied, setItem: vi.fn(denied) };
    const tabs = createChatTabsStore(storage);
    tabs.dismissChatTab("session-a");
    expect(tabs.chatTabsStore.getState().dismissed.has("session-a")).toBe(true);
    storage.setItem.mockClear();
    expect(() => tabs.release()).not.toThrow();
    expect(tabs.chatTabsStore.getState()).toEqual({ dismissed: new Set(), order: {} });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
