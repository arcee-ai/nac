// @vitest-environment node
import { expect, it, vi } from "vitest";
import { finishPresentation, PresentationTasks } from "./presentation-lifetime";

for (const failed of ["body", "release", "close", "stop"] as const) {
  it(`preserves the ${failed} failure and attempts all composed cleanup once in order`, async () => {
    const failure = new Error(failed);
    const events: string[] = [];
    const cleanup = ["release", "close", "stop"].map((stage) =>
      vi.fn(async () => {
        events.push(stage);
        if (stage === failed) throw failure;
      }),
    );
    const result = finishPresentation(failed === "body" ? [failure] : [], cleanup);
    await expect(result).rejects.toBe(failure);
    expect(events).toEqual(["release", "close", "stop"]);
    for (const dispose of cleanup) expect(dispose).toHaveBeenCalledOnce();
  });
}

it("retains an undefined body failure and all later failures in cleanup order", async () => {
  const failures = [undefined, new Error("release"), new Error("close"), new Error("stop")];
  const result = finishPresentation(
    [failures[0]],
    failures.slice(1).map((error) => () => {
      throw error;
    }),
  );
  const error = await result.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).cause).toBeUndefined();
  expect((error as AggregateError).errors).toEqual(failures);
  await expect(finishPresentation([undefined], [])).rejects.toBeUndefined();
});

it("drains other and follow-on routes after a rejection before closing or stopping", async () => {
  const tasks = new PresentationTasks();
  const failure = new Error("first route");
  tasks.track(Promise.reject(failure));
  // This failure must remain visible even when its task has already left the pending set.
  await Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const events: string[] = [];
  tasks.track(
    Promise.resolve().then(() => {
      tasks.track(
        gate.then(() => {
          events.push("follow-on settled");
        }),
      );
    }),
  );
  const result = finishPresentation(
    [],
    [
      () => tasks.drain(),
      () => {
        events.push("close");
      },
      () => {
        events.push("stop");
      },
    ],
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(events).toEqual([]);
  release();
  await expect(result).rejects.toBe(failure);
  expect(events).toEqual(["follow-on settled", "close", "stop"]);
  // A later drain must not report the same rejection twice.
  await tasks.drain();
});

it("completes successful composed cleanup", async () => {
  await expect(finishPresentation([], [async () => {}, () => {}])).resolves.toBeUndefined();
});
