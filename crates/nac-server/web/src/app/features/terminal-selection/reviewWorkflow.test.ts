import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { openSelectionOperation, previewSelection, submitSelection } from "./reviewWorkflow";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("selection operation ordering and lifetime", () => {
  it("settles accepted admission at its origin before any receipt presentation", async () => {
    const operation = openSelectionOperation(() => true);
    const order: string[] = [];
    await Effect.runPromise(
      submitSelection({
        operation,
        started: () => order.push("sending"),
        request: async (signal) => {
          expect(signal.aborted).toBe(false);
          order.push("dispatch");
          return "receipt";
        },
        accepted: () => order.push("origin"),
        unconfirmed: vi.fn(),
        confirmed: (receipt) => order.push(receipt),
        failed: vi.fn(),
      }),
    );
    expect(order).toEqual(["sending", "dispatch", "origin", "receipt"]);
    expect(operation.current()).toBe(false);
    expect(operation.signal.aborted).toBe(true);
  });

  it("closes synchronously while an abort-ignoring command can still settle its origin", async () => {
    const operation = openSelectionOperation(() => true);
    const result = deferred<string>();
    const accepted = vi.fn();
    const painted = vi.fn();
    const request = vi.fn(() => result.promise);
    const completion = Effect.runPromise(
      submitSelection({
        operation,
        started: vi.fn(),
        request,
        accepted,
        unconfirmed: vi.fn(),
        confirmed: (receipt) => {
          if (operation.current()) painted(receipt);
        },
        failed: vi.fn(),
      }),
    );
    operation.close();
    expect(operation.signal.aborted).toBe(true);
    expect(operation.current()).toBe(false);
    result.resolve("late receipt");
    await completion;
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(painted).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  for (const kind of ["preview", "submit"] as const) {
    it(`classifies a failed ${kind} once and releases resources without replay`, async () => {
      const operation = openSelectionOperation(() => true);
      const cause = new TypeError("transport lost response");
      const request = vi.fn().mockRejectedValue(cause);
      const failed = vi.fn();
      const confirmed = vi.fn();
      const accepted = vi.fn();
      const unconfirmed = vi.fn();
      const ports = {
        operation,
        started: vi.fn(),
        request,
        failed,
        confirmed,
        accepted,
        unconfirmed,
      };
      await Effect.runPromise(
        kind === "preview" ? previewSelection(ports) : submitSelection(ports),
      );
      expect(failed).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ _tag: "SelectionFailure", operation: kind, cause }),
      );
      expect(confirmed).not.toHaveBeenCalled();
      expect(accepted).not.toHaveBeenCalled();
      expect(unconfirmed).toHaveBeenCalledTimes(kind === "submit" ? 1 : 0);
      expect(request).toHaveBeenCalledTimes(1);
      expect(operation.signal.aborted).toBe(true);
    });
  }

  it("does not turn a settlement defect into a transport failure or replay", async () => {
    const operation = openSelectionOperation(() => true);
    const failed = vi.fn();
    const defect = new Error("cache adapter defect");
    const exit = await Effect.runPromiseExit(
      submitSelection({
        operation,
        started: vi.fn(),
        request: async () => "receipt",
        accepted: () => {
          throw defect;
        },
        unconfirmed: vi.fn(),
        confirmed: vi.fn(),
        failed,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.isNone(Cause.failureOption(exit.cause))).toBe(true);
      expect(Cause.squash(exit.cause)).toBe(defect);
    }
    expect(failed).not.toHaveBeenCalled();
    expect(operation.signal.aborted).toBe(true);
  });
});
