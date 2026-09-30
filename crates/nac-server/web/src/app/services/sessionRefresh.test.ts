import { afterEach, describe, expect, it } from "vitest";

import {
  beginSnapshotFetch,
  beginHistoryFetch,
  finishHistoryFetch,
  beginTailFetch,
  disposeSessionRefresh,
  finishSnapshotFetch,
  fenceSessionSnapshot,
  isCurrentSessionGeneration,
  sessionRefreshKey,
} from "@/app/services/sessionRefresh";

const SESSION_ID = "refresh-test";

afterEach(() => disposeSessionRefresh(SESSION_ID));

describe("session refresh fencing", () => {
  it("aborts historical reads on canonical replacement and view release", () => {
    const beforeReplacement = beginHistoryFetch(SESSION_ID);
    fenceSessionSnapshot(SESSION_ID, true);
    expect(beforeReplacement.controller.signal.aborted).toBe(true);
    finishHistoryFetch(SESSION_ID, beforeReplacement);
    const beforeRelease = beginHistoryFetch(SESSION_ID);
    disposeSessionRefresh(SESSION_ID);
    expect(beforeRelease.controller.signal.aborted).toBe(true);
  });

  it("isolates identical session IDs in separate endpoint/cache lifetimes", () => {
    const first = sessionRefreshKey({}, SESSION_ID);
    const second = sessionRefreshKey({}, SESSION_ID);
    const a = beginTailFetch(first);
    const b = beginTailFetch(second);
    disposeSessionRefresh(first);
    expect(a.controller.signal.aborted).toBe(true);
    expect(b.controller.signal.aborted).toBe(false);
    expect(isCurrentSessionGeneration(second, b.generation)).toBe(true);
    disposeSessionRefresh(second);
  });

  it("never accepts a snapshot from a disposed same-session lifetime", () => {
    const stale = beginSnapshotFetch(SESSION_ID);
    disposeSessionRefresh(SESSION_ID);
    const current = beginSnapshotFetch(SESSION_ID);

    expect(isCurrentSessionGeneration(SESSION_ID, stale.generation)).toBe(false);
    expect(isCurrentSessionGeneration(SESSION_ID, current.generation)).toBe(true);
  });

  it("does not consume a reopened lifetime's replacement from a stale completion", () => {
    const stale = beginSnapshotFetch(SESSION_ID);
    disposeSessionRefresh(SESSION_ID);
    const current = beginSnapshotFetch(SESSION_ID);
    fenceSessionSnapshot(SESSION_ID, true);

    finishSnapshotFetch(SESSION_ID, stale);
    expect(isCurrentSessionGeneration(SESSION_ID, stale.generation)).toBe(false);
    expect(isCurrentSessionGeneration(SESSION_ID, current.generation)).toBe(false);
    expect(beginSnapshotFetch(SESSION_ID).replace).toBe(true);
  });

  it("aborts and invalidates a tail read before a canonical snapshot", () => {
    const tail = beginTailFetch(SESSION_ID);
    expect(tail.controller.signal.aborted).toBe(false);

    const generation = fenceSessionSnapshot(SESSION_ID);

    expect(tail.controller.signal.aborted).toBe(true);
    expect(isCurrentSessionGeneration(SESSION_ID, tail.generation)).toBe(false);
    expect(isCurrentSessionGeneration(SESSION_ID, generation)).toBe(true);
  });

  it("consumes a destructive replacement only after acceptance", () => {
    fenceSessionSnapshot(SESSION_ID, true);
    const accepted = beginSnapshotFetch(SESSION_ID);
    expect(accepted).toMatchObject({ replace: true });

    finishSnapshotFetch(SESSION_ID, accepted);
    expect(beginSnapshotFetch(SESSION_ID)).toMatchObject({ replace: false });
  });

  it("does not let a stale snapshot consume replacement state", () => {
    fenceSessionSnapshot(SESSION_ID, true);
    const stale = beginSnapshotFetch(SESSION_ID);
    const current = beginSnapshotFetch(SESSION_ID);

    finishSnapshotFetch(SESSION_ID, stale);
    expect(current).toMatchObject({ replace: true });
  });
});
