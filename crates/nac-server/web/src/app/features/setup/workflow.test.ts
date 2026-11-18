import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import {
  createConfiguredChat,
  createProjectChat,
  runSetup,
  SetupFailure,
  requiresSetupReview,
} from "./workflow";
import { classifySetupFailure } from "./browserAdapters";
import { ApiError } from "@/app/services/api";

function ports() {
  return {
    current: () => true,
    classify: classifySetupFailure,
    reconcile: vi.fn(async (_phase: string) => {}),
  };
}

it("records a durable preset and project when chat admission is rejected, without replaying them", async () => {
  const model = vi.fn(async () => "preset");
  const project = vi.fn(async () => "project");
  const chat = vi.fn(async () => {
    throw new ApiError(409, "PATCH", "/test", "first chat already exists", "test-request");
  });
  const origin = ports();
  await expect(
    runSetup(createProjectChat({ ...origin, model, project, chat })),
  ).rejects.toMatchObject({ phase: "chat", kind: "conflict", completed: ["preset", "project"] });
  expect(model).toHaveBeenCalledTimes(1);
  expect(project).toHaveBeenCalledTimes(1);
  expect(chat).toHaveBeenCalledTimes(1);
  expect(origin.reconcile.mock.calls.map(([phase]) => phase)).toEqual([
    "preset",
    "project",
    "chat",
  ]);
});

it("settles an accepted origin write after detach and starts no following command", async () => {
  const accepted = Promise.withResolvers<string>();
  let attached = true;
  const origin = ports();
  const project = vi.fn(async () => "project");
  const result = runSetup(
    createProjectChat({
      ...origin,
      current: () => attached,
      model: () => accepted.promise,
      project,
      chat: async () => "chat",
    }),
  );
  await Promise.resolve();
  attached = false;
  accepted.resolve("preset");
  await expect(result).rejects.toMatchObject({
    phase: "project",
    kind: "cancelled",
    completed: ["preset"],
  });
  expect(origin.reconcile).toHaveBeenCalledWith("preset");
  expect(project).not.toHaveBeenCalled();
});

it.each([
  new TypeError("connection lost"),
  new ApiError(500, "PATCH", "/test", "save response failed", "test-request"),
])("retains unknown write outcomes without retry", async (cause) => {
  const chat = vi.fn(async () => {
    throw cause;
  });
  await expect(
    runSetup(createConfiguredChat({ ...ports(), model: async () => "model", chat })),
  ).rejects.toMatchObject({ phase: "chat", kind: "unknown" });
  expect(chat).toHaveBeenCalledTimes(1);
});

it("first-chat reads route to an existing chat without creating a preset or session", async () => {
  const model = vi.fn(async () => "model");
  const chat = vi.fn(async () => "new");
  expect(
    await runSetup(
      createConfiguredChat({ ...ports(), existing: async () => "existing", model, chat }),
    ),
  ).toBe("existing");
  expect(model).not.toHaveBeenCalled();
  expect(chat).not.toHaveBeenCalled();
});

it("keeps expected workflow errors distinct from defects", async () => {
  await expect(
    runSetup(
      Effect.fail(
        new SetupFailure({ phase: "read", kind: "conflict", cause: "changed", completed: [] }),
      ),
    ),
  ).rejects.toBeInstanceOf(SetupFailure);
  await expect(runSetup(Effect.die(new Error("defect")))).rejects.toThrow("defect");
});

it.each([false, true])(
  "classifies duplicate project rejection while retaining durable partial fences (preset saved: %s)",
  async (persistsModel) => {
    const project = vi.fn(async () => {
      throw new ApiError(409, "POST", "/projects", "Folder already used", "duplicate");
    });
    const chat = vi.fn(async () => "chat");
    const failure = await runSetup(
      createProjectChat({ ...ports(), persistsModel, model: async () => "preset", project, chat }),
    ).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      phase: "project",
      kind: "rejected",
      completed: persistsModel ? ["preset"] : [],
    });
    expect(requiresSetupReview(failure)).toBe(persistsModel);
    expect(project).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  },
);

it.each([
  new TypeError("Connection lost"),
  new ApiError(500, "POST", "/projects", "Response lost", "unknown"),
])("keeps unknown project admission fenced", async (cause) => {
  const project = vi.fn(async () => {
    throw cause;
  });
  const failure = await runSetup(
    createProjectChat({
      ...ports(),
      persistsModel: false,
      model: async () => "preset",
      project,
      chat: async () => "chat",
    }),
  ).catch((error: unknown) => error);
  expect(failure).toMatchObject({ phase: "project", kind: "unknown", completed: [] });
  expect(requiresSetupReview(failure)).toBe(true);
  expect(project).toHaveBeenCalledTimes(1);
});
