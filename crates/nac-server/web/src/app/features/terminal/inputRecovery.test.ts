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

describe("same-engine recovered-document acknowledgement", () => {
  it("requires acknowledgement for first-seen live executions, including newly created terminals", () => {
    const owner = new TerminalInputRecovery(128, true);
    const existing = owner.acquire("session", "engine:existing");
    const created = owner.acquire("session", "engine:new-terminal");
    expect(existing.current).toBe(true);
    expect(created.current).toBe(true);
    existing.acknowledge();
    expect(existing.current).toBe(false);
    expect(created.current).toBe(true);
  });

  it("retains acknowledged facts across normal remounts and shares them across readers", () => {
    const owner = new TerminalInputRecovery(128, true);
    const first = owner.acquire("session", "execution");
    const other = owner.acquire("session", "execution");
    first.acknowledge();
    expect(other.current).toBe(false);
    first.release();
    other.release();
    const remounted = owner.acquire("session", "execution");
    expect(remounted.available).toBe(true);
    expect(remounted.current).toBe(false);
    remounted.current = true; // A later lost receipt still requires another acknowledgement.
    remounted.release();
    expect(owner.acquire("session", "execution").current).toBe(true);
  });

  it("never evicts unresolved or actively observed facts, and conservatively re-acks reclaimed IDs", () => {
    const owner = new TerminalInputRecovery(2, true);
    const uncertain = owner.acquire("session", "uncertain");
    uncertain.release();
    const acknowledged = owner.acquire("session", "acknowledged");
    acknowledged.acknowledge();
    expect(owner.acquire("session", "third").available).toBe(false); // Active readers pin even acknowledged facts.
    acknowledged.release();
    const third = owner.acquire("session", "third");
    expect(third.available).toBe(true);
    expect(third.current).toBe(true);
    expect(owner.acquire("session", "uncertain").current).toBe(true);
    expect(owner.acquire("session", "acknowledged").available).toBe(false);
    third.acknowledge();
    third.release();
    const reclaimed = owner.acquire("session", "acknowledged");
    expect(reclaimed.available).toBe(true);
    expect(reclaimed.current).toBe(true);
  });

  it("keeps the production 128-entry bound fail-closed without dropping unresolved failures", () => {
    const owner = new TerminalInputRecovery(128, true);
    for (let id = 0; id < 128; id++) {
      const lease = owner.acquire("session", `execution-${id}`);
      expect(lease.current).toBe(true);
      lease.release();
    }
    const overflow = owner.acquire("session", "overflow");
    expect(overflow.available).toBe(false);
    expect(overflow.acknowledge()).toBe(false);
    expect(owner.acquire("session", "execution-0").current).toBe(true);
    expect(owner.acquire("session", "execution-127").current).toBe(true);
  });

  it("scopes acknowledgements to one owner and closes recovered facts without leaking to ordinary documents", () => {
    const recovered = new TerminalInputRecovery(128, true);
    const old = recovered.acquire("session", "same-execution");
    old.acknowledge();
    recovered.close();
    expect(old.available).toBe(false);
    expect(old.acknowledge()).toBe(false);
    expect(new TerminalInputRecovery(128, true).acquire("session", "same-execution").current).toBe(
      true,
    );
    expect(new TerminalInputRecovery().acquire("session", "same-execution").current).toBe(false);
  });
});

it("recovered read-only acquisition is unavailable and cannot seed or acknowledge a later live identity", () => {
  const recovered = new TerminalInputRecovery(128, true);
  const readonly = recovered.acquire("session", "same", true);
  expect(readonly.available).toBe(false);
  expect(readonly.acknowledge()).toBe(false);
  readonly.current = false;
  readonly.release();
  const live = recovered.acquire("session", "same");
  expect(live.available).toBe(true);
  expect(live.current).toBe(true);
  expect(new TerminalInputRecovery().acquire("session", "same", true).available).toBe(true);
});
