import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ApiError, UncertainCommandAdmissionError } from "@/app/services/nacClient";
import type { ShellCommandSnapshot } from "@/app/types/api";
import { createShellIntents } from "./intents";
import { HumanCommandFailure, runHumanCommand, submitHumanCommand } from "./workflow";

function command(
  requestId: string,
  state: ShellCommandSnapshot["state"] = "completed",
): ShellCommandSnapshot {
  return {
    request_id: requestId,
    operation_id: "operation",
    command: "[REDACTED]",
    state,
    timeout_ms: 30000,
    accepted_at_epoch_ms: 1,
    stdout: "",
    stderr: "",
  };
}
function ports() {
  const intents = createShellIntents();
  const submit = vi.fn(async (request: { request_id: string }) => command(request.request_id));
  return {
    sessionId: "session",
    command: "  printf SECRET\n",
    intents,
    submit,
    lookup: vi.fn(async (id: string) => command(id)),
    settled: vi.fn(),
  };
}

describe("runtime-owned human command admission", () => {
  it("retains the exact immutable unknown intent across attempts without automatic replay", async () => {
    const owner = ports();
    owner.submit.mockImplementationOnce(async (request) => {
      throw new UncertainCommandAdmissionError(request.request_id, new TypeError("lost ACK"));
    });
    await expect(runHumanCommand(submitHumanCommand(owner))).rejects.toBeInstanceOf(
      UncertainCommandAdmissionError,
    );
    const retained = owner.intents.get("session")!;
    expect(retained.phase).toBe("uncertain");
    expect(Object.isFrozen(retained.request)).toBe(true);
    expect(owner.submit).toHaveBeenCalledTimes(1);
    expect(owner.settled).toHaveBeenCalledTimes(1);
    await runHumanCommand(submitHumanCommand(owner));
    expect(owner.submit.mock.calls[1][0]).toBe(retained.request);
    expect(owner.intents.get("session")).toBeUndefined();
  });

  it("requires canonical readback before a changed command can acquire a new identity", async () => {
    const owner = ports();
    const prior = owner.intents.claim("session", "prior");
    owner.intents.uncertain("session", prior);
    const order: string[] = [];
    owner.lookup.mockImplementation(async (id) => {
      order.push("lookup");
      return command(id);
    });
    owner.settled.mockImplementation(() => order.push("origin"));
    owner.submit.mockImplementation(async (request) => {
      order.push("submit");
      return command(request.request_id);
    });
    await runHumanCommand(submitHumanCommand(owner));
    expect(order).toEqual(["lookup", "origin", "submit", "origin"]);
    expect(owner.submit.mock.calls[0][0].request_id).not.toBe(prior.request.request_id);
    expect(owner.intents.get("session")).toBeUndefined();
  });

  it("blocks a changed command when canonical lookup remains unknown or the prior command is active", async () => {
    for (const state of ["unknown", "started"] as const) {
      const owner = ports();
      const prior = owner.intents.claim("session", "prior");
      owner.intents.uncertain("session", prior);
      owner.lookup.mockImplementation(async (id) => {
        if (state === "unknown") throw new TypeError("lost readback");
        return command(id, "started");
      });
      await expect(runHumanCommand(submitHumanCommand(owner))).rejects.toBeInstanceOf(Error);
      expect(owner.submit).not.toHaveBeenCalled();
      expect(owner.settled).toHaveBeenCalledOnce();
      expect(owner.intents.get("session")?.request).toBe(
        state === "unknown" ? prior.request : undefined,
      );
    }
  });

  it("releases only matching intent on rejection or pre-dispatch cancellation", async () => {
    for (const error of [
      new ApiError(409, "POST", "/user-commands", "busy", "id"),
      new DOMException("not sent", "AbortError"),
    ]) {
      const owner = ports();
      owner.submit.mockRejectedValueOnce(
        new HumanCommandFailure({
          kind: error instanceof ApiError ? "rejected" : "not-sent",
          cause: error,
        }),
      );
      await expect(runHumanCommand(submitHumanCommand(owner))).rejects.toBe(error);
      expect(owner.intents.get("session")).toBeUndefined();
      expect(owner.settled).toHaveBeenCalledOnce();
    }
  });

  it("bounds unresolved storage without evicting identity, and isolates runtime disposal", () => {
    const first = createShellIntents();
    const other = createShellIntents();
    const prior = first.claim("same", "secret");
    first.uncertain("same", prior);
    expect(other.get("same")).toBeUndefined();
    expect(() => first.claim("oversized", "x".repeat(1024 * 1024))).toThrow(/storage is full/);
    expect(first.get("same")?.request).toBe(prior.request);
    first.release();
    expect(first.get("same")).toBeUndefined();
    expect(() => first.claim("same", "new")).toThrow(/runtime has been closed/);
    expect(other.claim("same", "new").request.request_id).not.toBe(prior.request.request_id);
  });

  it("does not replay or restore a confirmed intent after a settlement defect", async () => {
    const owner = ports();
    const defect = new Error("cache adapter defect");
    owner.settled.mockImplementation(() => {
      throw defect;
    });
    const exit = await Effect.runPromiseExit(submitHumanCommand(owner));
    expect(exit._tag).toBe("Failure");
    // Confirmation cleared this exact intent before the adapter defect.
    expect(owner.intents.get("session")).toBeUndefined();
    expect(owner.submit).toHaveBeenCalledOnce();
  });
});
