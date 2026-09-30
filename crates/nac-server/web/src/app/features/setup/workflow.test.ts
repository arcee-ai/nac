import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import {
  createConfiguredChat,
  createProjectChat,
  runSetup,
  saveSettings,
  SetupFailure,
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

it("does not save title or project defaults when session configuration is rejected", async () => {
  const title = vi.fn(async () => {});
  const projectDefault = vi.fn(async () => {});
  await expect(
    runSetup(
      saveSettings({
        ...ports(),
        check: async () => {},
        model: async () => "model",
        configuration: async () => {
          throw new ApiError(409, "PATCH", "/test", "session is active", "test-request");
        },
        title,
        projectDefault,
      }),
    ),
  ).rejects.toMatchObject({ phase: "configuration", kind: "conflict" });
  expect(title).not.toHaveBeenCalled();
  expect(projectDefault).not.toHaveBeenCalled();
});

it("makes a partial configuration/title save visible and does not update project defaults", async () => {
  const projectDefault = vi.fn(async () => {});
  await expect(
    runSetup(
      saveSettings({
        ...ports(),
        check: async () => {},
        model: async () => "model",
        configuration: async () => {},
        title: async () => {
          throw new ApiError(
            409,
            "PATCH",
            "/test",
            "presentation revision changed",
            "test-request",
          );
        },
        projectDefault,
      }),
    ),
  ).rejects.toMatchObject({ phase: "title", completed: ["preset", "configuration"] });
  expect(projectDefault).not.toHaveBeenCalled();
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

it("does not report pure model projection or a no-op configuration as durable partial progress", async () => {
  const origin = ports();
  await expect(
    runSetup(
      saveSettings({
        ...origin,
        check: async () => {},
        persistsModel: false,
        model: async () => "current",
        configurationSaved: false,
        configuration: async () => {},
        title: async () => {
          throw new ApiError(409, "PATCH", "/title", "revision changed", "test");
        },
      }),
    ),
  ).rejects.toMatchObject({ phase: "title", completed: [] });
  expect(origin.reconcile.mock.calls.map(([phase]) => phase)).toEqual(["title"]);
});
