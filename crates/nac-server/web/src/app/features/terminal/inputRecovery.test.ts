import { describe, expect, it, vi } from "vitest";
import { TerminalInputRecovery, recoveryForRuntime } from "./inputRecovery";

describe("scoped terminal delivery recovery", () => {
  it("retains uncertainty across detach/remount until explicit acknowledgement", () => {
    const owner = new TerminalInputRecovery();
    const first = owner.acquire("session", "owner-incarnation:execution");
    first.current = true;
    first.release();
    const next = owner.acquire("session", "owner-incarnation:execution");
    expect(next.current).toBe(true);
    expect(next.acknowledge()).toBe(true);
    expect(next.current).toBe(false);
    next.release();
    expect(owner.acquire("session", "owner-incarnation:execution").current).toBe(false);
  });

  it("isolates session, execution incarnation and consumer runtime identity", () => {
    const left = recoveryForRuntime({});
    const right = recoveryForRuntime({});
    left.acquire("session", "old-incarnation:execution").current = true;
    expect(left.acquire("other-session", "old-incarnation:execution").current).toBe(false);
    expect(left.acquire("session", "new-incarnation:execution").current).toBe(false);
    expect(right.acquire("session", "old-incarnation:execution").current).toBe(false);
  });

  it("refuses fresh capacity without evicting unresolved failures", () => {
    const owner = new TerminalInputRecovery(2);
    for (const id of ["first", "second"]) {
      const lease = owner.acquire("session", id);
      lease.current = true;
      lease.release();
    }
    const refused = owner.acquire("session", "third");
    expect(refused.available).toBe(false);
    expect(refused.acknowledge()).toBe(false);
    refused.current = true;
    refused.release();
    const first = owner.acquire("session", "first");
    expect(first.current).toBe(true);
    first.acknowledge();
    first.release();
    expect(owner.acquire("session", "third").available).toBe(true);
    expect(owner.acquire("session", "second").current).toBe(true);
  });

  it("shares boolean changes among views and releases all state on runtime disposal", () => {
    const owner = new TerminalInputRecovery();
    const first = owner.acquire("session", "execution");
    const second = owner.acquire("session", "execution");
    const changed = vi.fn();
    second.subscribe(changed);
    first.current = true;
    expect(second.current).toBe(true);
    second.acknowledge();
    expect(first.current).toBe(false);
    expect(changed).toHaveBeenCalledTimes(2);
    owner.close();
    expect(first.available).toBe(false);
    expect(second.available).toBe(false);
    first.current = true;
    expect(owner.acquire("session", "execution").available).toBe(false);
  });
});
