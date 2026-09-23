/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";

import {
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
});
