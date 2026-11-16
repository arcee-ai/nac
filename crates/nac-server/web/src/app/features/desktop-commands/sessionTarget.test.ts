import { describe, expect, it, vi } from "vitest";
import {
  connectSessionTargets,
  type SessionTargetOutcome,
  type NotificationSessionTarget,
} from "./sessionTarget";

function fixture(
  open = vi.fn(
    async (_target: NotificationSessionTarget, _signal: AbortSignal) =>
      "opened" as SessionTargetOutcome,
  ),
) {
  let receive!: (message: unknown) => Promise<SessionTargetOutcome>;
  const disconnect = vi.fn();
  const close = connectSessionTargets(
    {
      connectSessionTarget: (owner) => {
        receive = owner;
        return disconnect;
      },
    },
    open,
  );
  return { open, receive: (message: unknown) => receive(message), close, disconnect };
}
const request = (sequence = 1) => ({
  version: 1,
  source: "notification-response",
  request: sequence,
  profile: "profile",
  launch: "engine",
  view: "view",
  document: "document",
  target: { session_id: "canonical-session", occurrence_id: "semantic-occurrence" },
});

describe("notification session target", () => {
  it("consumes a bounded request once and passes only IDs plus cancellation to the routing owner", async () => {
    const f = fixture();
    expect(await f.receive(request())).toBe("opened");
    expect(await f.receive(request())).toBe("unavailable");
    expect(f.open).toHaveBeenCalledOnce();
    expect(f.open.mock.calls[0]).toEqual([request().target, expect.any(AbortSignal)]);
    f.close();
    expect(f.disconnect).toHaveBeenCalledOnce();
  });
  it.each([
    { ...request(), command: "resume" },
    { ...request(), request: true },
    { ...request(), request: 2147483648 },
    { ...request(), source: "menu" },
    { ...request(), target: { ...request().target, prompt: "run" } },
    { ...request(), target: { session_id: "\n", occurrence_id: "A" } },
    { ...request(), target: { session_id: "x".repeat(513), occurrence_id: "A" } },
  ])("rejects malformed or expanded authority before invoking the owner", async (message) => {
    const f = fixture();
    expect(await f.receive(message)).toBe("unavailable");
    expect(f.open).not.toHaveBeenCalled();
    f.close();
  });
  it("aborts superseded and retired lookups, consuming late outcomes as stale", async () => {
    const pending: { signal: AbortSignal; resolve: (outcome: SessionTargetOutcome) => void }[] = [];
    const open = vi.fn(
      (_target, signal: AbortSignal) =>
        new Promise<SessionTargetOutcome>((resolve) => pending.push({ signal, resolve })),
    );
    const f = fixture(open);
    const first = f.receive(request(1));
    const second = f.receive(request(2));
    expect(pending[0].signal.aborted).toBe(true);
    pending[0].resolve("opened");
    expect(await first).toBe("stale");
    f.close();
    expect(pending[1].signal.aborted).toBe(true);
    pending[1].resolve("opened");
    expect(await second).toBe("stale");
    expect(await f.receive(request(3))).toBe("stale");
  });
  it("returns a deferral without retaining a retry or navigating later", async () => {
    const f = fixture(vi.fn(async () => "deferred" as SessionTargetOutcome));
    expect(await f.receive(request())).toBe("deferred");
    await Promise.resolve();
    expect(f.open).toHaveBeenCalledOnce();
    f.close();
  });
});
