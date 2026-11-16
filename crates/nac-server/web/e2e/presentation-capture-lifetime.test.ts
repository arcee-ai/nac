// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserContext, Page, Route, TestInfo } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("@playwright/test", () => ({ chromium: { launchPersistentContext: transport.launch } }));
import { ownFrontendServing, sealFrontendAssets, serveFrontendAssets } from "./frontend-assets";
import { openNameZoom } from "./session-name-zoom";
import { ownPackedCapturePage } from "./presentation-capture-page";

const roots: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-capture-lifetime-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "index.html"), "<head></head><body>preserved</body>");
  const sealed = await sealFrontendAssets(root);
  const events: string[] = [];
  let closed = false;
  let handler!: (route: Route) => Promise<void>;
  const unroute = vi.fn(async () => {
    expect(closed).toBe(false);
    events.push("dispose");
  });
  let address = "about:blank";
  const navigate = (url: string) => {
    address = url;
  };
  const goto = vi.fn(async (url: string) => navigate(url));
  const evaluate = vi.fn(async () => 2);
  const close = vi.fn(async () => {
    events.push("close");
    closed = true;
  });
  const page = {
    url: () => address,
    route: async (_match: unknown, callback: typeof handler) => {
      handler = callback;
    },
    unroute,
    goto,
    emulateMedia: vi.fn(async () => {}),
  } as unknown as Page;
  const context = {
    grantPermissions: vi.fn(async () => {}),
    serviceWorkers: () => [{ evaluate }],
    newPage: async () => page,
    close,
  } as unknown as BrowserContext;
  transport.launch.mockResolvedValue(context);
  const info = { outputPath: (...parts: string[]) => path.join(root, ...parts) } as TestInfo;
  const owner = ownFrontendServing();
  const prepare = async () =>
    owner.retain(await serveFrontendAssets(page, "http://127.0.0.1:1234", sealed));
  return {
    owner,
    page,
    navigate,
    events,
    goto,
    evaluate,
    close,
    unroute,
    prepare,
    info,
    context,
    handler: () => handler,
  };
}

for (const stage of ["goto", "zoom"] as const) {
  it(`drains the capture's sealed serving before close on ${stage} failure, exactly once`, async () => {
    const f = await fixture();
    const primary = new Error(stage);
    (stage === "goto" ? f.goto : f.evaluate).mockRejectedValueOnce(primary);
    const error = await openNameZoom(
      f.info,
      "http://127.0.0.1:1234",
      f.prepare,
      undefined,
      f.owner.dispose,
    ).catch((error: unknown) => error);
    expect(error).toBe(primary);
    expect(f.events).toEqual(["dispose", "close"]);
    expect(f.owner.current).toBeUndefined();
    await f.owner.dispose(); // The caller's outer finally must not dispose twice.
    expect(f.unroute).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
  });

  it(`retains ${stage}, serving and close errors without retrying disposal`, async () => {
    const f = await fixture();
    const primary = new Error(stage),
      disposal = new Error("disposal"),
      close = new Error("close");
    (stage === "goto" ? f.goto : f.evaluate).mockRejectedValueOnce(primary);
    f.unroute.mockImplementationOnce(async () => {
      f.events.push("dispose");
      throw disposal;
    });
    f.close.mockImplementationOnce(async () => {
      f.events.push("close");
      throw close;
    });
    const error = await openNameZoom(
      f.info,
      "http://127.0.0.1:1234",
      f.prepare,
      undefined,
      f.owner.dispose,
    ).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).cause).toBe(primary);
    expect((error as AggregateError).errors).toEqual([primary, disposal, close]);
    await f.owner.dispose();
    expect(f.events).toEqual(["dispose", "close"]);
    expect(f.unroute).toHaveBeenCalledOnce();
    expect(f.close).toHaveBeenCalledOnce();
  });
}

it("holds failed zoom open until a real sealed missing-font request abort settles", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  let entered!: () => void;
  const ready = new Promise<void>((done) => {
    entered = done;
  });
  let request!: Promise<void>;
  const primary = new Error("zoom");
  f.evaluate.mockRejectedValueOnce(primary);
  const prepare = async () => {
    await f.prepare();
    request = f.handler()({
      request: () => ({
        url: () => "http://127.0.0.1:1234/assets/dist/missing.woff",
        method: () => "GET",
        resourceType: () => "font",
      }),
      abort: async () => {
        entered();
        await gate;
      },
      fallback: () => {
        throw new Error("Current frontend fallback forbidden");
      },
      fetch: () => {
        throw new Error("Current frontend fetch forbidden");
      },
    } as unknown as Route);
  };
  let settled = false;
  const result = openNameZoom(f.info, "http://127.0.0.1:1234", prepare, undefined, f.owner.dispose)
    .catch((error: unknown) => error)
    .finally(() => {
      settled = true;
    });
  await ready;
  try {
    await new Promise<void>((done) => setImmediate(done));
    expect(settled).toBe(false);
    expect(f.close).not.toHaveBeenCalled();
    expect(f.unroute).not.toHaveBeenCalled();
  } finally {
    release();
  }
  const error = await result;
  await request;
  expect((error as AggregateError).cause).toBe(primary);
  expect((error as AggregateError).errors[0]).toBe(primary);
  expect(String((error as AggregateError).errors[1])).toContain("no current fallback");
  expect(f.events).toEqual(["dispose", "close"]);
  await f.owner.dispose();
  expect(f.unroute).toHaveBeenCalledOnce();
});

it("keeps successful capture serving owned until the outer finally", async () => {
  const f = await fixture();
  const opened = await openNameZoom(
    f.info,
    "http://127.0.0.1:1234",
    f.prepare,
    undefined,
    f.owner.dispose,
  );
  expect(opened.zoom).toBe(2);
  expect(f.owner.current).toBeDefined();
  expect(f.unroute).not.toHaveBeenCalled();
  await f.owner.dispose();
  await opened.context.close();
  expect(f.events).toEqual(["dispose", "close"]);
});

it("never treats an un-navigated harness document as a packed runtime", async () => {
  const f = await fixture();
  f.navigate("http://127.0.0.1:9999/design");
  const closeRuntime = vi.fn(async () => {});
  const assertClosed = vi.fn(async () => {});
  const packed = ownPackedCapturePage("http://127.0.0.1:1234", closeRuntime, assertClosed);
  packed.retain(f.page);
  await packed.dispose();
  expect(closeRuntime).not.toHaveBeenCalled();
  expect(assertClosed).not.toHaveBeenCalled();
});

for (const stage of ["prepare", "goto", "zoom"] as const) {
  it(`cleans the actual packed zoom document before context close on ${stage} failure`, async () => {
    const f = await fixture();
    const primary = new Error(stage);
    const closeRuntime = vi.fn(async (page: Page, name: "Left" | "Right") => {
      expect(page).toBe(f.page);
      f.events.push(`packed:${name}`);
    });
    const assertClosed = vi.fn(async (page: Page) => {
      expect(page).toBe(f.page);
      f.events.push("packed:zero");
    });
    const packed = ownPackedCapturePage("http://127.0.0.1:1234", closeRuntime, assertClosed);
    if (stage === "goto")
      f.goto.mockImplementationOnce(async (url) => {
        f.navigate(url); // Navigation committed before load failed.
        throw primary;
      });
    if (stage === "zoom") f.evaluate.mockRejectedValueOnce(primary);
    const result = await openNameZoom(
      f.info,
      "http://127.0.0.1:1234",
      async (page) => {
        packed.retain(page);
        await f.prepare();
        if (stage === "prepare") throw primary;
      },
      undefined,
      async () => {
        await packed.dispose();
        await f.owner.dispose();
      },
    ).catch((error: unknown) => error);
    expect(result).toBe(primary);
    expect(f.events).toEqual(
      stage === "prepare"
        ? ["dispose", "close"]
        : ["packed:Left", "packed:Right", "packed:zero", "dispose", "close"],
    );
    await packed.dispose();
    await f.owner.dispose();
    expect(closeRuntime).toHaveBeenCalledTimes(stage === "prepare" ? 0 : 2);
    expect(assertClosed).toHaveBeenCalledTimes(stage === "prepare" ? 0 : 1);
    expect(f.close).toHaveBeenCalledOnce();
  });
}

it("attempts both packed closes and zero assertion, retaining primary and all close errors", async () => {
  const f = await fixture();
  const primary = new Error("zoom"),
    left = new Error("left"),
    zero = new Error("zero"),
    closing = new Error("context");
  f.evaluate.mockRejectedValueOnce(primary);
  f.close.mockRejectedValueOnce(closing);
  const packed = ownPackedCapturePage(
    "http://127.0.0.1:1234",
    async (_page, name) => {
      f.events.push(name);
      if (name === "Left") throw left;
    },
    async () => {
      f.events.push("zero");
      throw zero;
    },
  );
  const error = (await openNameZoom(
    f.info,
    "http://127.0.0.1:1234",
    async (page) => {
      packed.retain(page);
    },
    undefined,
    async () => {
      await packed.dispose();
    },
  ).catch((error: unknown) => error)) as AggregateError;
  expect(error.cause).toBe(primary);
  expect(error.errors[0]).toBe(primary);
  expect((error.errors[1] as AggregateError).errors).toEqual([left, zero]);
  expect(error.errors[2]).toBe(closing);
  expect(f.events).toEqual(["Left", "Right", "zero"]);
  await packed.dispose();
  expect(f.events).toEqual(["Left", "Right", "zero"]);
  expect(f.close).toHaveBeenCalledOnce();
});
