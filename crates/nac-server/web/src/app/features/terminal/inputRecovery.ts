type Entry = { failed: boolean; readers: number; listeners: Set<() => void> };

export interface TerminalInputRecoveryLease {
  current: boolean;
  readonly available: boolean;
  subscribe(listener: () => void): () => void;
  acknowledge(): boolean;
  release(): void;
}

/** Process-local delivery facts only: no input bytes, retries or authority. */
export class TerminalInputRecovery {
  private readonly entries = new Map<string, Entry>();
  private closed = false;

  constructor(private readonly limit = 128) {}

  acquire(sessionId: string, executionId: string): TerminalInputRecoveryLease {
    const key = JSON.stringify([sessionId, executionId]);
    let entry = this.entries.get(key);
    if (!this.closed && !entry && this.entries.size < this.limit) {
      entry = { failed: false, readers: 0, listeners: new Set() };
      this.entries.set(key, entry);
    }
    if (entry) entry.readers++;
    let released = false;
    const subscriptions = new Set<() => void>();
    const available = () => !this.closed && !released && !!entry && this.entries.get(key) === entry;
    const lease: TerminalInputRecoveryLease = {
      get available() {
        return available();
      },
      get current() {
        return available() && !!entry?.failed;
      },
      set current(failed: boolean) {
        if (!available() || !entry || entry.failed === failed) return;
        entry.failed = failed;
        const snapshot = Array.from(entry.listeners);
        for (const listener of snapshot) listener();
      },
      subscribe(listener) {
        if (available()) {
          subscriptions.add(listener);
          entry?.listeners.add(listener);
        }
        return () => {
          subscriptions.delete(listener);
          entry?.listeners.delete(listener);
        };
      },
      acknowledge() {
        if (!available()) return false;
        lease.current = false;
        return true;
      },
      release: () => {
        if (released) return;
        if (entry) {
          for (const listener of subscriptions) entry.listeners.delete(listener);
          entry.readers--;
          // Unresolved failures never disappear merely because a view detached.
          if (!entry.failed && !entry.readers) this.entries.delete(key);
        }
        subscriptions.clear();
        released = true;
        entry = undefined;
      },
    };
    return lease;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      const snapshot = Array.from(entry.listeners);
      for (const listener of snapshot) listener();
      entry.listeners.clear();
    }
  }
}

// Compatibility fixtures have no NativeRuntime lifecycle. Their identity is
// still private to one consumer object; there is no endpoint/global ID cache.
const compatibilityOwners = new WeakMap<object, TerminalInputRecovery>();
export function recoveryForRuntime(
  runtime: object & { terminalInputRecovery?: TerminalInputRecovery },
) {
  if (runtime.terminalInputRecovery) return runtime.terminalInputRecovery;
  let owner = compatibilityOwners.get(runtime);
  if (!owner) {
    owner = new TerminalInputRecovery();
    compatibilityOwners.set(runtime, owner);
  }
  return owner;
}
