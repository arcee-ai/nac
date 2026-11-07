// @vitest-environment node
import { expect, it, vi } from "vitest";
import { activatePacked390Model, type Journey } from "./presentation-composed-fixture";
import type { Locator } from "@playwright/test";

// The actual reading helper runs; only its browser transport and harness import are fake.
vi.mock("./harness", async () => {
  const { expect } = await import("vitest");
  const assertion = (value: unknown) => {
    if (value && typeof value === "object" && "locatorSentinel" in value)
      return {
        toBeVisible: async () => {},
        toBeEnabled: async () => {},
        toHaveCount: async (count: number) => expect(count).toBe(1),
      };
    return expect(value);
  };
  return {
    expect: Object.assign(assertion, { poll: expect.poll }),
    initializeHarnessWorkspace: () => {
      throw new Error("No real harness workspace");
    },
  };
});

type Options = {
  wheel?: boolean;
  failClick?: boolean;
  primary?: unknown;
  failCleanup?: boolean;
  secondary?: unknown;
  failAttach?: boolean;
  missingTarget?: boolean;
};
function fixture(options: Options = {}) {
  const events: string[] = [];
  const cleanup = (name: string) =>
    vi.fn(() => {
      events.push(name);
      if (options.failCleanup) throw options.secondary;
      return Promise.resolve();
    });
  const wheelEvents: { trusted: boolean; x: number; y: number }[] = [];
  const stop = cleanup("wheel.stop"),
    wheelDispose = cleanup("wheel.dispose");
  const record = { events: wheelEvents, stop };
  const wheelHandle = {
    evaluate: async <T>(fn: (value: typeof record) => T) => fn(record),
    dispose: wheelDispose,
  };
  const targetDispose = cleanup("target.dispose"),
    ownerDispose = cleanup("owner.dispose");
  const owner = {
    evaluate: async () => true,
    evaluateHandle: async () => wheelHandle,
    dispose: ownerDispose,
  };
  let reads = 0;
  const target = {
    evaluate: async () => {
      const initial = reads++ === 0;
      return {
        connected: true,
        owned: true,
        width: 390,
        documentWidth: 390,
        height: 900,
        pageScrollY: 0,
        rect: { x: 20, width: 200, height: 44 },
        centerHit: !options.wheel || !initial,
        footerHit: !!options.wheel,
        footer: { top: 700 },
        dialog: { left: 0, right: 390 },
        header: { bottom: 20 },
        body: { left: 10, right: 380, top: 40, bottom: 700 },
        scrollTop: initial ? 0 : 120,
        scrollHeight: 1000,
        clientHeight: 500,
      };
    },
    isVisible: async () => true,
    isEnabled: async () => true,
    click: vi.fn(async () => {
      events.push("target.click");
      if (options.failClick) throw options.primary;
    }),
    dispose: targetDispose,
  };
  const model = {
    locatorSentinel: true,
    elementHandle: async () => (options.missingTarget ? null : target),
    click: vi.fn(),
  };
  const body = { locatorSentinel: true, elementHandle: async () => owner };
  const form = { locator: () => body };
  const wheel = vi.fn(async (x: number, y: number) => {
    wheelEvents.push({ trusted: true, x, y });
  });
  const attach = vi.fn(async (_name: string, _payload: unknown) => {
    events.push("attach");
    if (options.failAttach) throw options.secondary;
  });
  const j = {
    transport: "packed",
    width: 390,
    page: {
      locator: () => ({ evaluate: async () => {} }),
      mouse: { move: async () => {}, wheel },
    },
    fixture: {
      state: {
        projectAttempts: 0,
        sessionCreates: 0,
        configWrites: 0,
        secretWrites: 0,
        loginStarts: 0,
        cloneStarts: 0,
        cloneCancels: 0,
        mcpTests: 0,
      },
      calls: [],
    },
    harness: { provider: { requests: [] }, binaryPath: "fake-transport-only" },
    info: { attach },
  } as unknown as Journey;
  const run = () =>
    activatePacked390Model(j, form as unknown as Locator, model as unknown as Locator);
  return {
    run,
    events,
    wheel,
    attach,
    target,
    model,
    stop,
    wheelDispose,
    targetDispose,
    ownerDispose,
  };
}
async function outcome(promise: Promise<void>) {
  return promise.then(
    () => ({ ok: true as const }),
    (reason: unknown) => ({ ok: false as const, reason }),
  );
}
function reason(result: Awaited<ReturnType<typeof outcome>>) {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected rejection");
  return result.reason;
}
function allCleanupAttempted(fake: ReturnType<typeof fixture>) {
  for (const dispose of [fake.stop, fake.wheelDispose, fake.targetDispose, fake.ownerDispose])
    expect(dispose).toHaveBeenCalledOnce();
  for (const step of ["wheel.dispose", "target.dispose", "owner.dispose"])
    expect(fake.events.indexOf("wheel.stop")).toBeLessThan(fake.events.indexOf(step));
  expect(fake.model.click).not.toHaveBeenCalled();
}

it("initial positive hit uses the original handle with zero wheel and no recovery claim", async () => {
  const fake = fixture();
  await fake.run();
  expect(fake.wheel).not.toHaveBeenCalled();
  expect(fake.target.click).toHaveBeenCalledOnce();
  expect(fake.model.click).not.toHaveBeenCalled();
  const payload = fake.attach.mock.calls[0]![1] as { body: string };
  expect(JSON.parse(payload.body)).toMatchObject({
    wheelInputs: 0,
    recovered: false,
    clickCompleted: true,
  });
  expect(fake.targetDispose).toHaveBeenCalledOnce();
  expect(fake.ownerDispose).toHaveBeenCalledOnce();
});

it("retains exact primary identity through failed observer stop, disposals and attachment", async () => {
  const primary = {},
    secondary = new Error("cleanup");
  const fake = fixture({
    wheel: true,
    failClick: true,
    primary,
    failCleanup: true,
    secondary,
    failAttach: true,
  });
  expect(reason(await outcome(fake.run()))).toBe(primary);
  allCleanupAttempted(fake);
  expect(fake.wheel).toHaveBeenCalledOnce();
  expect(fake.wheel).toHaveBeenCalledWith(0, 120);
  expect(fake.attach).toHaveBeenCalledOnce();
});

it("retains an actual thrown undefined despite synchronous undefined cleanup failures", async () => {
  const fake = fixture({
    wheel: true,
    failClick: true,
    primary: undefined,
    failCleanup: true,
    secondary: undefined,
    failAttach: true,
  });
  expect(reason(await outcome(fake.run()))).toBeUndefined();
  allCleanupAttempted(fake);
  expect(fake.attach).toHaveBeenCalledOnce();
});

it("rejects successful input when cleanup fails and retains all secondary objects", async () => {
  const secondary = new Error("cleanup");
  const fake = fixture({ wheel: true, failCleanup: true, secondary });
  const failure = reason(await outcome(fake.run()));
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toHaveLength(4);
  for (const item of (failure as AggregateError).errors) expect(item).toBe(secondary);
  allCleanupAttempted(fake);
  expect(fake.target.click).toHaveBeenCalledOnce();
});

it("rejects successful input when evidence attachment fails", async () => {
  const secondary = new Error("attach");
  const fake = fixture({ failAttach: true, secondary });
  const failure = reason(await outcome(fake.run()));
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors[0]).toBe(secondary);
  expect(fake.targetDispose).toHaveBeenCalledOnce();
  expect(fake.ownerDispose).toHaveBeenCalledOnce();
});

it("preserves the missing-original-handle error when available-handle disposal throws", async () => {
  const secondary = new Error("dispose");
  const fake = fixture({ missingTarget: true, failCleanup: true, secondary });
  const failure = reason(await outcome(fake.run()));
  expect(String(failure)).toContain("Original target/body unavailable");
  expect(failure).not.toBe(secondary);
  expect(fake.ownerDispose).toHaveBeenCalledOnce();
  expect(fake.target.click).not.toHaveBeenCalled();
});
