/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSessionNavigationStore,
  markSessionViewed,
  restoreSessionNavigation,
  serializeSessionNavigation,
  sessionNavigationStore,
  toggleSessionNavigationPin,
} from "@/app/store/sessionNavigationStore";

beforeEach(() => {
  sessionNavigationStore.setState({ pinned: new Set(), lastViewedAt: {} });
});

describe("session navigation browser persistence", () => {
  it("round-trips pins and last-viewed markers without server presentation fields", () => {
    const state = {
      pinned: new Set(["session-b", "session-a"]),
      lastViewedAt: { "session-a": "2026-09-22T12:00:00Z" },
    };
    expect(restoreSessionNavigation(serializeSessionNavigation(state))).toEqual(state);
    expect(restoreSessionNavigation("not json")).toEqual({ pinned: new Set(), lastViewedAt: {} });
  });

  it("persists pin toggles and only advances last-viewed time", () => {
    toggleSessionNavigationPin("session-a");
    markSessionViewed("session-a", "2026-09-22T12:00:00Z");
    markSessionViewed("session-a", "2026-09-21T12:00:00Z");

    expect(sessionNavigationStore.getState()).toEqual({
      pinned: new Set(["session-a"]),
      lastViewedAt: { "session-a": "2026-09-22T12:00:00Z" },
    });
    expect(
      restoreSessionNavigation(serializeSessionNavigation(sessionNavigationStore.getState())),
    ).toEqual(sessionNavigationStore.getState());

    toggleSessionNavigationPin("session-a");
    expect(sessionNavigationStore.getState().pinned.size).toBe(0);
  });

  it("preserves latest preferences on release and fences writes from a retired owner", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const first = createSessionNavigationStore(storage);
    first.toggleSessionNavigationPin("session-a");
    first.markSessionViewed("session-a", "2026-09-22T12:00:00Z");
    const saved = values.get("nac.sessionNavigation");
    storage.setItem.mockClear();

    first.release();
    expect(first.sessionNavigationStore.getState()).toEqual({
      pinned: new Set(),
      lastViewedAt: {},
    });
    expect(values.get("nac.sessionNavigation")).toBe(saved);
    expect(storage.setItem).not.toHaveBeenCalled();

    const next = createSessionNavigationStore(storage);
    expect(next.sessionNavigationStore.getState()).toEqual({
      pinned: new Set(["session-a"]),
      lastViewedAt: { "session-a": "2026-09-22T12:00:00Z" },
    });
    next.toggleSessionNavigationPin("session-b");
    next.markSessionViewed("session-a", "2026-09-23T12:00:00Z");
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    const current = values.get("nac.sessionNavigation");
    expect(JSON.parse(current!)).toEqual({
      pinned: ["session-a", "session-b"],
      lastViewedAt: { "session-a": "2026-09-23T12:00:00Z" },
    });
    storage.setItem.mockClear();

    first.toggleSessionNavigationPin("stale-session");
    first.markSessionViewed("stale-session", "2026-09-24T12:00:00Z");
    first.release();
    first.release();
    expect(values.get("nac.sessionNavigation")).toBe(current);
    expect(storage.setItem).not.toHaveBeenCalled();
    next.release();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("keeps live in-memory preferences usable when storage is unavailable", () => {
    const denied = () => {
      throw new Error("storage unavailable");
    };
    const storage = { getItem: denied, setItem: vi.fn(denied) };
    const navigation = createSessionNavigationStore(storage);
    navigation.toggleSessionNavigationPin("session-a");
    expect(navigation.sessionNavigationStore.getState().pinned.has("session-a")).toBe(true);
    storage.setItem.mockClear();
    expect(() => navigation.release()).not.toThrow();
    expect(navigation.sessionNavigationStore.getState()).toEqual({
      pinned: new Set(),
      lastViewedAt: {},
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
