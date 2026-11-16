// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { APIRequestContext, BrowserContext, Page, Route, TestInfo } from "@playwright/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("@playwright/test", () => ({ chromium: { launchPersistentContext: transport.launch } }));
vi.mock("./harness", async () => ({
  expect: (await import("vitest")).expect,
  initializeHarnessWorkspace: vi.fn(async () => {}),
}));
import type { EmbeddedHarness } from "./harness";
import { installComposedFixture } from "./presentation-composed-fixture";
import { ownComposedCleanup, ownPackedCapturePage } from "./presentation-capture-page";
import { finishPresentation } from "./presentation-lifetime";
import { openNameZoom } from "./session-name-zoom";

const endpoint = "http://127.0.0.1:1234/packed";
const roots: string[] = [];
beforeEach(() => vi.stubEnv("NAC_PRESENTATION_MATCHED_WORKSPACE_ROOT", undefined));
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const checkpoint = () => new Promise<void>((done) => setImmediate(done));
function leaves(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
}

async function fixture() {
  const events: string[] = [];
  type Handler = (route: Route) => Promise<void>;
  type Match = string | ((url: URL) => boolean);
  const routes: { match: Match; handler: Handler }[] = [];
  const host = vi.fn(async () => {});
  let address = "about:blank";
  let onUnroute: () => Promise<void> = async () => {};
  const fulfill = vi.fn(async () => {});
  const unroute = vi.fn(async (match: Match, handler: Handler) => {
    events.push("unroute");
    expect(match).toBe(owned.match);
    expect(handler).toBe(owned.handler);
    await onUnroute();
    const index = routes.findIndex((entry) => entry.match === match && entry.handler === handler);
    if (index >= 0) routes.splice(index, 1);
  });
  const goto = vi.fn(async (url: string) => {
    address = url;
  });
  const evaluate = vi.fn(async () => 2);
  const close = vi.fn(async () => {
    events.push("context");
  });
  const page = {
    url: () => address,
    route: async (match: Match, handler: Handler) => {
      routes.push({ match, handler });
    },
    unroute,
    goto,
    emulateMedia: vi.fn(async () => {}),
  } as unknown as Page;
  await page.route("**/*", host);
  const request = {
    get: async () => ({
      ok: () => true,
      json: async () => ({
        providers: [
          { id: "openai-responses", models: [{ id: "fixture", display_name: "Fixture" }] },
        ],
      }),
    }),
  } as unknown as APIRequestContext;
  const harness = {
    runRoot: "/synthetic-owned-composed-fixture",
    baseUrl: "http://127.0.0.1:1234",
    provider: { baseUrl: "http://127.0.0.1:5678" },
  } as unknown as EmbeddedHarness;
  const boundary = await installComposedFixture(page, request, harness, endpoint, 768);
  const owned = routes[1];
  const dispatch = () => {
    const task = owned.handler({
      request: () => ({
        method: () => "GET",
        url: () => `${endpoint}/models`,
        headers: () => ({}),
      }),
      fulfill,
    } as unknown as Route);
    // Simulate the transport observing the returned rejection. The fixture must
    // independently retain it, even if rejection precedes terminal draining.
    void task.catch(() => {});
    return task;
  };
  const context = {
    grantPermissions: vi.fn(async () => {}),
    serviceWorkers: () => [{ evaluate }],
    newPage: async () => page,
    close,
  } as unknown as BrowserContext;
  transport.launch.mockResolvedValue(context);
  return {
    events,
    routes,
    host,
    owned,
    page,
    boundary,
    dispatch,
    fulfill,
    unroute,
    goto,
    evaluate,
    close,
    navigate: () => {
      address = endpoint;
    },
    onUnroute: (callback: () => Promise<void>) => {
      onUnroute = callback;
    },
  };
}

async function zoomInfo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-composed-lifetime-"));
  roots.push(root);
  return { outputPath: (...parts: string[]) => path.join(root, ...parts) } as TestInfo;
}

it("unlocks pending work without disposing the route; terminal release is the same promise", async () => {
  const f = await fixture();
  const task = f.dispatch();
  await checkpoint();
  expect(f.fulfill).not.toHaveBeenCalled();
  f.boundary.unlock();
  f.boundary.unlock();
  await task;
  expect(f.routes).toContain(f.owned);
  expect(f.unroute).not.toHaveBeenCalled();
  const first = f.boundary.release();
  expect(f.boundary.release()).toBe(first);
  await first;
  await f.boundary.release();
  expect(f.unroute).toHaveBeenCalledOnce();
  expect(f.routes).toEqual([{ match: "**/*", handler: f.host }]);
});

it("tracks an unmount request before removing the boundary and closing context/process", async () => {
  const f = await fixture();
  const held = deferred();
  f.fulfill.mockImplementationOnce(() => held.promise);
  f.navigate();
  let unmount!: Promise<void>;
  const packed = ownPackedCapturePage(
    endpoint,
    async (page, name) => {
      expect(page).toBe(f.page);
      expect(f.routes).toContain(f.owned);
      f.events.push(name);
      if (name === "Left") unmount = f.dispatch();
    },
    async (page) => {
      expect(page).toBe(f.page);
      f.events.push("zero");
    },
  );
  packed.retain(f.page);
  const cleanup = ownComposedCleanup(
    () => f.boundary,
    packed,
    async () => {
      f.events.push("serving");
    },
  );
  const stop = vi.fn(async () => {
    f.events.push("process");
  });
  const done = finishPresentation([], [cleanup.dispose, f.close, stop]);
  await checkpoint();
  expect(f.events).toEqual(["Left", "Right", "zero"]);
  expect(f.close).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
  held.resolve();
  await unmount;
  await done;
  await cleanup.dispose();
  expect(f.events).toEqual(["Left", "Right", "zero", "unroute", "serving", "context", "process"]);
  expect(f.unroute).toHaveBeenCalledOnce();
});

it("final-drains work admitted around exact unroute and preserves the unrelated host route", async () => {
  const f = await fixture();
  const held = deferred();
  const lateFailure = new Error("late admission");
  f.fulfill.mockImplementationOnce(() => held.promise);
  f.onUnroute(async () => {
    void f.dispatch();
  });
  const result = f.boundary.release().catch((error: unknown) => error);
  let settled = false;
  void result.then(() => {
    settled = true;
  });
  await checkpoint();
  expect(f.unroute).toHaveBeenCalledOnce();
  expect(f.routes).toEqual([{ match: "**/*", handler: f.host }]);
  expect(settled).toBe(false);
  held.reject(lateFailure);
  expect(await result).toBe(lateFailure);
  expect(f.host).not.toHaveBeenCalled();
});

it("attempts unroute and final drain after pre-drain failure, retaining all errors once", async () => {
  const f = await fixture();
  const pre = new Error("pre-drain"),
    unroute = new Error("unroute"),
    late = new Error("final-drain");
  f.fulfill.mockRejectedValueOnce(pre).mockRejectedValueOnce(late);
  f.boundary.unlock();
  await expect(f.dispatch()).rejects.toBe(pre);
  f.onUnroute(async () => {
    void f.dispatch();
    throw unroute;
  });
  const first = f.boundary.release();
  expect(f.boundary.release()).toBe(first);
  const error = await first.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual([pre, unroute, late]);
  expect((error as AggregateError).cause).toBe(pre);
  expect(await f.boundary.release().catch((error: unknown) => error)).toBe(error);
  expect(f.unroute).toHaveBeenCalledOnce();
});

for (const stage of ["prepare", "goto", "zoom"] as const) {
  it(`disposes the retained prepared page before context close on ${stage} failure`, async () => {
    const f = await fixture();
    const primary = new Error(stage);
    const held = deferred(),
      entered = deferred();
    f.fulfill.mockImplementationOnce(() => held.promise);
    f.onUnroute(async () => {
      void f.dispatch();
      entered.resolve();
    });
    const packed = ownPackedCapturePage(
      endpoint,
      async (page, name) => {
        expect(page).toBe(f.page);
        f.events.push(name);
      },
      async () => {
        f.events.push("zero");
      },
    );
    const cleanup = ownComposedCleanup(() => f.boundary, packed);
    const prepare = async (page: Page) => {
      expect(page).toBe(f.page);
      packed.retain(page);
      if (stage === "prepare") throw primary;
    };
    if (stage === "goto")
      f.goto.mockImplementationOnce(async () => {
        f.navigate();
        throw primary;
      });
    if (stage === "zoom") f.evaluate.mockRejectedValueOnce(primary);
    const result = openNameZoom(
      await zoomInfo(),
      endpoint,
      prepare,
      undefined,
      cleanup.beforeContextClose,
    ).catch((error: unknown) => error);
    await entered.promise;
    await checkpoint();
    expect(f.close).not.toHaveBeenCalled();
    held.resolve();
    const error = await result;
    expect(error).toBe(primary);
    await finishPresentation(
      [],
      [
        cleanup.dispose,
        async () => {
          f.events.push("process");
        },
      ],
    );
    expect(f.events).toEqual(
      stage === "prepare"
        ? ["unroute", "context", "process"]
        : ["Left", "Right", "zero", "unroute", "context", "process"],
    );
    expect(f.unroute).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
  });
}

it("retains primary, both runtime closes, zero assertion, route, serving, context and stop failures", async () => {
  const f = await fixture();
  const primary = new Error("zoom"),
    left = new Error("Left"),
    right = new Error("Right"),
    zero = new Error("global zero"),
    pre = new Error("pre-drain"),
    unroute = new Error("unroute"),
    late = new Error("final-drain"),
    serving = new Error("serving"),
    context = new Error("context"),
    stop = new Error("process");
  f.evaluate.mockRejectedValueOnce(primary);
  f.close.mockImplementationOnce(async () => {
    f.events.push("context");
    throw context;
  });
  f.fulfill.mockRejectedValueOnce(pre).mockRejectedValueOnce(late);
  f.onUnroute(async () => {
    void f.dispatch();
    throw unroute;
  });
  const packed = ownPackedCapturePage(
    endpoint,
    async (page, name) => {
      expect(page).toBe(f.page);
      f.events.push(name);
      throw name === "Left" ? left : right;
    },
    async () => {
      f.events.push("zero");
      throw zero;
    },
  );
  const disposeServing = vi.fn(async () => {
    f.events.push("serving");
    throw serving;
  });
  const cleanup = ownComposedCleanup(() => f.boundary, packed, disposeServing);
  const primaryWithCleanup = await openNameZoom(
    await zoomInfo(),
    endpoint,
    async (page) => {
      packed.retain(page);
      void f.dispatch();
    },
    undefined,
    cleanup.beforeContextClose,
  ).catch((error: unknown) => error);
  expect((primaryWithCleanup as AggregateError).cause).toBe(primary);
  const result = await finishPresentation(
    [primaryWithCleanup],
    [
      cleanup.dispose,
      async () => {
        f.events.push("process");
        throw stop;
      },
    ],
  ).catch((error: unknown) => error);
  expect(leaves(result)).toEqual([
    primary,
    left,
    right,
    zero,
    pre,
    unroute,
    late,
    serving,
    context,
    stop,
  ]);
  expect((result as AggregateError).cause).toBe(primaryWithCleanup);
  expect(f.events).toEqual(["Left", "Right", "zero", "unroute", "serving", "context", "process"]);
  await cleanup.dispose();
  expect(disposeServing).toHaveBeenCalledOnce();
  expect(f.unroute).toHaveBeenCalledOnce();
  expect(f.close).toHaveBeenCalledOnce();
});
