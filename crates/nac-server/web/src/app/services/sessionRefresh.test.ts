import { afterEach, describe, expect, it } from "vitest";

import {
  beginSnapshotFetch,
  beginTailFetch,
  disposeSessionRefresh,
  finishSnapshotFetch,
  fenceSessionSnapshot,
  isCurrentSessionGeneration,
} from "@/app/services/sessionRefresh";

const SESSION_ID = "refresh-test";

afterEach(() => disposeSessionRefresh(SESSION_ID));

describe("session refresh fencing", () => {
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
