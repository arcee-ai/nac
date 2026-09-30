import { describe, expect, it, vi } from "vitest";
import { createChat, deliverPrompt, runCommand, submitPrompt } from "./commandWorkflow";

it("accepts the created snapshot before allowing navigation", async () => {
  const events: string[] = [];
  const created = await runCommand(
    createChat({
      create: async () => {
        events.push("create");
        return "a";
      },
      accept: () => {
        events.push("snapshot");
      },
    }),
  );
  events.push(`open:${created}`);
  expect(events).toEqual(["create", "snapshot", "open:a"]);
});

describe("single prompt admission", () => {
  for (const kind of ["accepted", "not-sent", "uncertain"] as const) {
    it(`settles ${kind} without replaying admission`, async () => {
      const error = new Error(kind);
      const optimistic = vi.fn();
      const rejected = vi.fn();
      const reconcile = vi.fn();
      const admit = vi.fn(async () =>
        kind === "accepted" ? { kind, value: "accepted-response" } : { kind, error },
      );
      const result = runCommand(submitPrompt({ optimistic, rejected, reconcile, admit }));
      if (kind === "accepted") expect(await result).toBe("accepted-response");
      else await expect(result).rejects.toBe(error);
      expect(admit).toHaveBeenCalledOnce();
      expect(optimistic).toHaveBeenCalledOnce();
      if (kind === "not-sent") {
        expect(rejected).toHaveBeenCalledOnce();
        expect(reconcile).not.toHaveBeenCalled();
      } else {
        expect(rejected).not.toHaveBeenCalled();
        expect(reconcile).toHaveBeenCalledWith(kind === "uncertain");
      }
    });
  }
});

it("routes direct durable input, classic steering and idle submission independently", async () => {
  const inbox = vi.fn(async () => undefined);
  const steer = vi.fn(async () => undefined);
  const submit = vi.fn(async () => undefined);
  const ports = { inbox, steer, submit };
  expect(await runCommand(deliverPrompt({ ...ports, mode: "direct-running" }))).toBe("steered");
  expect(
    await runCommand(deliverPrompt({ ...ports, mode: "direct-running", delivery: "queue" })),
  ).toBe("queued");
  expect(await runCommand(deliverPrompt({ ...ports, mode: "classic-running" }))).toBe("steered");
  expect(await runCommand(deliverPrompt({ ...ports, mode: "idle" }))).toBe("submitted");
  expect(inbox.mock.calls).toEqual([["steer"], ["queue"]]);
  expect(steer).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledOnce();
});
