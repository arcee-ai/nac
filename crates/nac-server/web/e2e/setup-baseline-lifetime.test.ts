// @vitest-environment node
// Proposed characterization only: UNRUN/UNCHECKED; requires the six reviewed postimages.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page, Route, TestInfo } from "@playwright/test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("@playwright/test", () => ({
  chromium: { launchPersistentContext: transport.launch },
}));
// Do not import the real harness, register its fixtures or start subprocesses.
vi.mock("./harness", () => ({
  expect: () => {
    throw new Error("Unexpected harness assertion");
  },
  initializeHarnessWorkspace: () => {
    throw new Error("Unexpected harness workspace");
  },
}));
import { withSetupBaselines } from "./setup-visual-fixture";
import { openNameZoom } from "./session-name-zoom";

const origin = "http://127.0.0.1:1234";
const roots: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NAC_SETUP_BASELINE_DIST", undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  transport.launch.mockReset();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function observe<T>(promise: Promise<T>) {
  const state = { settled: false };
  const result = promise.then(
    (value) => {
      state.settled = true;
      return { ok: true as const, value };
    },
    (error: unknown) => {
      state.settled = true;
      return { ok: false as const, error };
    },
  );
  return { state, result };
}
function rejected(outcome: { ok: boolean; error?: unknown }) {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("Expected rejection");
  return outcome.error;
}
function leaves(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
}
const checkpoint = () => new Promise<void>((resolve) => setImmediate(resolve));
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-baseline-lifetime-"));
  roots.push(root);
  const directory = path.join(root, "dist");
  await fs.mkdir(directory);
  await fs.writeFile(path.join(directory, "index.html"), "<head></head><body>sealed</body>");
  await fs.writeFile(path.join(directory, "entry.js"), "sealed");
  vi.stubEnv("NAC_SETUP_BASELINE_DIST", directory);
  const info = { outputPath: (...parts: string[]) => path.join(root, ...parts) } as TestInfo;
  return { root, directory, info };
}
function context(events: string[], name: string) {
  const close = vi.fn(async () => {
    events.push(`close:${name}`);
  });
  return { context: { close } as unknown as BrowserContext, close };
}
function page(owner: BrowserContext, events: string[], name: string) {
  type Match = (url: URL) => boolean;
  type Handler = (route: Route) => Promise<void>;
  let installed: { match: Match; handler: Handler } | undefined;
  const route = vi.fn(async (match: Match, handler: Handler) => {
    expect(installed).toBeUndefined();
    installed = { match, handler };
    events.push(`route:${name}`);
  });
  const unroute = vi.fn(async (match: Match, handler: Handler) => {
    expect(match).toBe(installed?.match);
    expect(handler).toBe(installed?.handler);
    events.push(`unroute:${name}`);
  });
  const goto = vi.fn(async () => {});
  const emulateMedia = vi.fn(async () => {});
  const owningContext = vi.fn(() => owner);
  return {
    page: { route, unroute, context: owningContext, goto, emulateMedia } as unknown as Page,
    route,
    unroute,
    goto,
    emulateMedia,
    owningContext,
    handler: () => {
      if (!installed) throw new Error("No installed real-sealer handler");
      expect(installed.match(new URL(origin))).toBe(true);
      return installed.handler;
    },
  };
}
async function missingFont(fake: ReturnType<typeof page>) {
  const entered = deferred(),
    release = deferred();
  const abort = vi.fn(async () => {
    entered.resolve();
    await release.promise;
  });
  const fetch = vi.fn(),
    fallback = vi.fn(),
    fulfill = vi.fn();
  const route = {
    request: () => ({
      url: () => `${origin}/assets/dist/optional.woff2`,
      method: () => "GET",
      resourceType: () => "font",
    }),
    abort,
    fetch,
    fallback,
    fulfill,
  } as unknown as Route;
  const task = fake.handler()(route);
  await entered.promise;
  return { task, release: release.resolve, abort, fetch, fallback, fulfill };
}
function zoomTransport(fake: ReturnType<typeof page>, owner: ReturnType<typeof context>) {
  const evaluate = vi.fn(async () => 2);
  Object.assign(owner.context, {
    grantPermissions: vi.fn(async () => {}),
    serviceWorkers: () => [{ evaluate }],
    newPage: vi.fn(async () => fake.page),
  });
  transport.launch.mockResolvedValue(owner.context);
  return { evaluate };
}

it("L01 rejects a successful body only after the real late-font handler drains", async () => {
  await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "a");
  const ready = deferred();
  let font!: Awaited<ReturnType<typeof missingFont>>;
  const observed = observe(
    withSetupBaselines(async (baseline) => {
      await baseline.serve(fake.page, origin);
      font = await missingFont(fake);
      ready.resolve();
      return "body passed";
    }),
  );
  await ready.promise;
  try {
    await checkpoint();
    expect(observed.state.settled).toBe(false);
    expect(fake.unroute).not.toHaveBeenCalled();
  } finally {
    font.release();
    await font.task;
    await observed.result;
  }
  await font.task;
  expect(String(rejected(await observed.result))).toContain("no current fallback");
  expect(font.abort).toHaveBeenCalledOnce();
  expect(font.abort).toHaveBeenCalledWith("failed");
  expect(font.fetch).not.toHaveBeenCalled();
  expect(font.fallback).not.toHaveBeenCalled();
  expect(font.fulfill).not.toHaveBeenCalled();
  expect(fake.unroute).toHaveBeenCalledOnce();
  expect(owner.close).not.toHaveBeenCalled();
});

it("L02 retains body and real-disposer errors by identity", async () => {
  await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "a");
  const body = new Error("body"),
    dispose = new Error("unroute");
  fake.unroute.mockRejectedValueOnce(dispose);
  const result = await observe(
    withSetupBaselines(async (baseline) => {
      await baseline.serve(fake.page, origin);
      throw body;
    }),
  ).result;
  const error = rejected(result);
  expect(error).toBeInstanceOf(AggregateError);
  expect(leaves(error)).toHaveLength(2);
  expect(leaves(error)[0]).toBe(body);
  expect(leaves(error)[1]).toBe(dispose);
  expect(fake.unroute).toHaveBeenCalledOnce();
});

it("L03 retains body, disposal and close errors and never retries disposal", async () => {
  await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "a");
  const body = new Error("body"),
    dispose = new Error("unroute"),
    close = new Error("close");
  fake.unroute.mockImplementationOnce(async () => {
    events.push("dispose-failed");
    throw dispose;
  });
  owner.close.mockImplementationOnce(async () => {
    events.push("close-failed");
    throw close;
  });
  const error = rejected(
    await observe(
      withSetupBaselines(async (baseline) => {
        await baseline.serve(fake.page, origin);
        return baseline.withContext(owner.context, async () => {
          throw body;
        });
      }),
    ).result,
  );
  expect(leaves(error)).toHaveLength(3);
  for (const [index, expected] of [body, dispose, close].entries())
    expect(leaves(error)[index]).toBe(expected);
  expect(events.slice(-2)).toEqual(["dispose-failed", "close-failed"]);
  expect(fake.unroute).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
});

it("L04 waits for another page after one same-context disposer has rejected", async () => {
  await fixture();
  const events: string[] = [],
    owner = context(events, "A");
  const first = page(owner.context, events, "a"),
    second = page(owner.context, events, "b");
  const dispose = new Error("first unroute"),
    ready = deferred();
  first.unroute.mockRejectedValueOnce(dispose);
  let font!: Awaited<ReturnType<typeof missingFont>>;
  const observed = observe(
    withSetupBaselines(async (baseline) => {
      await baseline.serve(first.page, origin);
      await baseline.serve(second.page, origin);
      font = await missingFont(second);
      ready.resolve();
      return baseline.withContext(owner.context, async () => "ok");
    }),
  );
  await ready.promise;
  try {
    await checkpoint();
    expect(first.unroute).toHaveBeenCalledOnce();
    expect(second.unroute).not.toHaveBeenCalled();
    expect(owner.close).not.toHaveBeenCalled();
    expect(observed.state.settled).toBe(false);
  } finally {
    font.release();
    await font.task;
    await observed.result;
  }
  await font.task;
  const error = rejected(await observed.result);
  expect(leaves(error)).toHaveLength(2);
  expect(leaves(error)[0]).toBe(dispose);
  expect(String(leaves(error)[1])).toContain("no current fallback");
  expect(first.unroute).toHaveBeenCalledOnce();
  expect(second.unroute).toHaveBeenCalledOnce();
  expect(events.slice(-2)).toEqual(["unroute:b", "close:A"]);
});

it("L05 selectively claims actual-context pages exactly once", async () => {
  await fixture();
  const events: string[] = [],
    a = context(events, "A"),
    b = context(events, "B");
  const first = page(a.context, events, "a"),
    second = page(b.context, events, "b");
  await withSetupBaselines(async (baseline) => {
    await baseline.serve(first.page, origin);
    await baseline.serve(second.page, origin);
    await baseline.beforeContextClose(a.context);
    await baseline.beforeContextClose(a.context);
    expect(first.unroute).toHaveBeenCalledOnce();
    expect(second.unroute).not.toHaveBeenCalled();
  });
  expect(second.unroute).toHaveBeenCalledOnce();
  expect(first.owningContext).toHaveBeenCalledOnce();
  expect(second.owningContext).toHaveBeenCalledOnce();
  expect(a.close).not.toHaveBeenCalled();
  expect(b.close).not.toHaveBeenCalled();
});

it("L06 drains the prepared zoom page before close and retains all errors", async () => {
  const { info } = await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "zoom");
  zoomTransport(fake, owner);
  const body = new Error("goto"),
    dispose = new Error("unroute"),
    close = new Error("close");
  fake.goto.mockRejectedValueOnce(body);
  fake.unroute.mockImplementationOnce(async () => {
    events.push("dispose-failed");
    throw dispose;
  });
  owner.close.mockImplementationOnce(async () => {
    events.push("close-failed");
    throw close;
  });
  const error = rejected(
    await observe(
      withSetupBaselines((baseline) =>
        openNameZoom(
          info,
          origin,
          (actual) => {
            expect(actual).toBe(fake.page);
            return baseline.serve(actual, origin);
          },
          undefined,
          baseline.beforeContextClose,
        ),
      ),
    ).result,
  );
  expect((error as AggregateError).cause).toBe(body);
  expect(leaves(error)).toHaveLength(3);
  for (const [index, expected] of [body, dispose, close].entries())
    expect(leaves(error)[index]).toBe(expected);
  expect(events.slice(-2)).toEqual(["dispose-failed", "close-failed"]);
  expect(fake.unroute).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
});

it("L07 holds failed zoom preparation open until the real font abort settles", async () => {
  const { info } = await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "zoom");
  const { evaluate } = zoomTransport(fake, owner);
  const body = new Error("worker"),
    ready = deferred();
  evaluate.mockRejectedValueOnce(body);
  let font!: Awaited<ReturnType<typeof missingFont>>;
  const observed = observe(
    withSetupBaselines((baseline) =>
      openNameZoom(
        info,
        origin,
        async (actual) => {
          await baseline.serve(actual, origin);
          font = await missingFont(fake);
          ready.resolve();
        },
        undefined,
        baseline.beforeContextClose,
      ),
    ),
  );
  await ready.promise;
  try {
    await checkpoint();
    expect(evaluate).toHaveBeenCalledOnce();
    expect(owner.close).not.toHaveBeenCalled();
    expect(fake.unroute).not.toHaveBeenCalled();
    expect(observed.state.settled).toBe(false);
  } finally {
    font.release();
    await font.task;
    await observed.result;
  }
  await font.task;
  const error = rejected(await observed.result);
  expect((error as AggregateError).cause).toBe(body);
  expect(leaves(error)).toHaveLength(2);
  expect(leaves(error)[0]).toBe(body);
  expect(String(leaves(error)[1])).toContain("no current fallback");
  expect(events.slice(-2)).toEqual(["unroute:zoom", "close:A"]);
  expect(fake.unroute).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
});

it("L08 preserves happy opted-in zoom and disposes before its owning close", async () => {
  const { info } = await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "zoom");
  zoomTransport(fake, owner);
  const value = {};
  expect(
    await withSetupBaselines(async (baseline) => {
      const opened = await openNameZoom(
        info,
        origin,
        (actual) => baseline.serve(actual, origin),
        undefined,
        baseline.beforeContextClose,
      );
      expect(opened.page).toBe(fake.page);
      expect(opened.context).toBe(owner.context);
      expect(opened.zoom).toBe(2);
      expect(owner.close).not.toHaveBeenCalled();
      return baseline.withContext(opened.context, async () => value);
    }),
  ).toBe(value);
  expect(events.slice(-2)).toEqual(["unroute:zoom", "close:A"]);
  expect(fake.unroute).toHaveBeenCalledOnce();
  expect(owner.close).toHaveBeenCalledOnce();
});

function poisonedPage() {
  const fail = vi.fn(() => {
    throw new Error("Inert branch touched Page");
  });
  return { page: { context: fail, route: fail } as unknown as Page, fail };
}
it("L09 keeps no-baseline serving inert while closing an explicit context", async () => {
  const fake = poisonedPage(),
    events: string[] = [],
    owner = context(events, "A"),
    value = {};
  const realpath = vi.spyOn(fs, "realpath").mockRejectedValue(new Error("Unexpected sealer"));
  expect(
    await withSetupBaselines(async (baseline) => {
      await baseline.serve(fake.page, origin);
      return baseline.withContext(owner.context, async () => value);
    }),
  ).toBe(value);
  expect(fake.fail).not.toHaveBeenCalled();
  expect(realpath).not.toHaveBeenCalled();
  expect(owner.close).toHaveBeenCalledOnce();
});

it("L10 preserves the original no-baseline body error without page access", async () => {
  const fake = poisonedPage(),
    body = new Error("body");
  expect(
    rejected(
      await observe(
        withSetupBaselines(async (baseline) => {
          await baseline.serve(fake.page, origin);
          throw body;
        }),
      ).result,
    ),
  ).toBe(body);
  expect(fake.fail).not.toHaveBeenCalled();
});

it("L11 retains the existing unrelated non-opt-in close-failure semantics", async () => {
  const { info } = await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "zoom");
  zoomTransport(fake, owner);
  const body = new Error("goto"),
    close = new Error("close");
  fake.goto.mockRejectedValueOnce(body);
  owner.close.mockRejectedValueOnce(close);
  expect(rejected(await observe(openNameZoom(info, origin)).result)).toBe(close);
  expect(fake.route).not.toHaveBeenCalled();
  expect(owner.close).toHaveBeenCalledOnce();
});

it("L12 rejects duplicate sequential page ownership and disposes only once", async () => {
  await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "a");
  const error = rejected(
    await observe(
      withSetupBaselines(async (baseline) => {
        await baseline.serve(fake.page, origin);
        await baseline.serve(fake.page, origin);
      }),
    ).result,
  );
  expect(String(error)).toContain("already has a serving owner");
  expect(fake.route).toHaveBeenCalledOnce();
  expect(fake.unroute).toHaveBeenCalledOnce();
});

it("L13 retains unrelated non-opt-in success without owning its context", async () => {
  const { info } = await fixture();
  const events: string[] = [],
    owner = context(events, "A"),
    fake = page(owner.context, events, "zoom");
  zoomTransport(fake, owner);
  const opened = await openNameZoom(info, origin);
  expect(opened.page).toBe(fake.page);
  expect(opened.context).toBe(owner.context);
  expect(opened.zoom).toBe(2);
  expect(owner.close).not.toHaveBeenCalled();
  expect(fake.route).not.toHaveBeenCalled();
  await opened.context.close();
  expect(owner.close).toHaveBeenCalledOnce();
});
