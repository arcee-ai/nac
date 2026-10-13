import type { ShellCommandRequest } from "@/app/types/api";

export interface ShellIntent {
  readonly request: Readonly<ShellCommandRequest>;
  readonly phase: "dispatching" | "uncertain";
}

/** Private runtime-owned intents, never persisted or retained in a query cache. */
export function createShellIntents() {
  const pending = new Map<string, ShellIntent>();
  let released = false;
  const maxSessions = 32;
  const maxBytes = 1024 * 1024;
  const bytes = (command: string) => new TextEncoder().encode(command).byteLength;
  return {
    get: (sessionId: string) => pending.get(sessionId),
    claim(sessionId: string, command: string): ShellIntent {
      if (released) throw new Error("This command's runtime has been closed.");
      const previous = pending.get(sessionId);
      if (previous?.phase === "dispatching") throw new Error("A command admission is in progress.");
      if (previous) {
        const intent = Object.freeze({ ...previous, phase: "dispatching" as const });
        pending.set(sessionId, intent);
        return intent;
      }
      const total = [...pending.values()].reduce(
        (size, intent) => size + bytes(intent.request.command),
        0,
      );
      if (pending.size >= maxSessions || total + bytes(command) > maxBytes)
        throw new Error(
          "Unconfirmed command storage is full. Reconcile prior commands or shorten this command before sending.",
        );
      const intent = Object.freeze({
        request: Object.freeze({ request_id: crypto.randomUUID(), command }),
        phase: "dispatching" as const,
      });
      pending.set(sessionId, intent);
      return intent;
    },
    confirmed(sessionId: string, intent: ShellIntent) {
      if (pending.get(sessionId)?.request === intent.request) pending.delete(sessionId);
    },
    uncertain(sessionId: string, intent: ShellIntent) {
      if (pending.get(sessionId)?.request === intent.request)
        pending.set(sessionId, Object.freeze({ ...intent, phase: "uncertain" as const }));
    },
    release() {
      released = true;
      pending.clear();
    },
  };
}
export type ShellIntents = ReturnType<typeof createShellIntents>;
