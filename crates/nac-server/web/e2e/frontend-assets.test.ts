// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { afterEach, expect, it, vi } from "vitest";
import {
  bindFrontendDocument,
  frontendHash,
  readSealedFrontend,
  sealFrontendAssets,
  serveFrontendAssets,
} from "./frontend-assets";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-sealed-frontend-"));
  roots.push(root);
  await fs.writeFile(path.join(root, "index.html"), "<head></head><body>baseline</body>");
  await fs.writeFile(path.join(root, "entry.js"), "baseline");
  return sealFrontendAssets(root);
}

it("rejects missing and extra inventory entries", async () => {
  const sealed = await fixture();
  await fs.unlink(path.join(sealed.directory, "entry.js"));
  await expect(sealFrontendAssets(sealed.directory, sealed.files)).rejects.toThrow(
    "inventory drift",
  );
  await fs.writeFile(path.join(sealed.directory, "entry.js"), "baseline");
  await fs.writeFile(path.join(sealed.directory, "foreign.js"), "foreign");
  await expect(sealFrontendAssets(sealed.directory, sealed.files)).rejects.toThrow(
    "inventory drift",
  );
});

it("rejects unlisted, escaping and encoded paths", async () => {
  const sealed = await fixture();
  for (const name of ["foreign.js", "../entry.js", "/entry.js", "%2e%2e/entry.js", "a\\entry.js"])
    await expect(readSealedFrontend(sealed, name)).rejects.toThrow();
});

it("rejects same-size hash drift and mode drift after sealing", async () => {
  const sealed = await fixture();
  await fs.writeFile(path.join(sealed.directory, "entry.js"), "modified");
  await expect(readSealedFrontend(sealed, "entry.js")).rejects.toThrow("hash drift");
  await fs.writeFile(path.join(sealed.directory, "entry.js"), "baseline");
  await fs.chmod(path.join(sealed.directory, "entry.js"), 0o700);
  await expect(readSealedFrontend(sealed, "entry.js")).rejects.toThrow("mode drift");
});

it("rejects a substituted symlink", async () => {
  const sealed = await fixture();
  await fs.unlink(path.join(sealed.directory, "entry.js"));
  await fs.symlink(
    path.join(sealed.directory, "index.html"),
    path.join(sealed.directory, "entry.js"),
  );
  await expect(readSealedFrontend(sealed, "entry.js")).rejects.toThrow("symlink");
});

it("injects only one genuine bootstrap, preserving the baseline document", () => {
  const template = '<head><script src="baseline.js"></script></head>';
  const binding =
    '<script id="nac-presentation-binding" type="application/json">{"scope":{"incarnation":"real"}}</script>';
  expect(
    bindFrontendDocument(template, `<head>${binding}<script src="current.js"></script></head>`)
      .html,
  ).toBe(template.replace("</head>", binding + "</head>"));
  for (const live of [
    "<head></head>",
    binding + binding,
    binding.replace('{"scope":{"incarnation":"real"}}', "invalid"),
  ])
    expect(() => bindFrontendDocument(template, live)).toThrow();
  expect(() => bindFrontendDocument(binding + template, binding)).toThrow("already bound");
});

it("aborts an unknown asset without fetching or falling through to the current producer", async () => {
  const sealed = await fixture();
  const handlers: ((route: Route) => Promise<void>)[] = [];
  const page = {
    route: async (_match: unknown, handler: (route: Route) => Promise<void>) => {
      handlers.push(handler);
    },
    unroute: async () => {},
  } as unknown as Page;
  const serving = await serveFrontendAssets(page, "http://127.0.0.1:1234", sealed);
  const request = {
    url: () => "http://127.0.0.1:1234/assets/dist/missing.js",
    method: () => "GET",
    resourceType: () => "script",
  };
  const abort = vi.fn(async () => {}),
    fetch = vi.fn(),
    fallback = vi.fn();
  const route = { request: () => request, abort, fetch, fallback } as unknown as Route;
  await handlers[0](route);
  expect(abort).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  await expect(serving.dispose()).rejects.toThrow("no current fallback");
});

it("preserves literal dollar tokens in the genuine bootstrap bytes and hash", () => {
  const template = "<head><title>prefix</title></head><body>suffix</body>";
  const payload = { build: { id: "$$ $' $`", release: "$& $1 $$" } };
  const binding = `<script id="nac-presentation-binding" type="application/json">${JSON.stringify(payload)}</script>`;
  const bound = bindFrontendDocument(template, `<head>${binding}</head>`);
  expect(bound.html).toBe(`<head><title>prefix</title>${binding}</head><body>suffix</body>`);
  expect(bound.bindingSha256).toBe(frontendHash(binding));
  expect(JSON.parse(bound.html.split('type="application/json">')[1].split("</script>")[0])).toEqual(
    payload,
  );
});

async function routedFixture() {
  const sealed = await fixture();
  let handler!: (route: Route) => Promise<void>;
  let match!: (url: URL) => boolean;
  const unroute = vi.fn(async (actualMatch, actualHandler) => {
    expect(actualMatch).toBe(match);
    expect(actualHandler).toBe(handler);
  });
  const page = {
    route: async (predicate: typeof match, callback: typeof handler) => {
      match = predicate;
      handler = callback;
    },
    unroute,
  } as unknown as Page;
  const serving = await serveFrontendAssets(page, "http://127.0.0.1:1234", sealed);
  return { serving, unroute, route: (route: Route) => handler(route) };
}

function assetRequest(name: string, type: string) {
  return {
    url: () => `http://127.0.0.1:1234${name}`,
    method: () => "GET",
    resourceType: () => type,
  };
}

it("drains a font route started by document fulfillment before removing its exact handler", async () => {
  const f = await routedFixture();
  let releaseFont!: () => void;
  const fontGate = new Promise<void>((resolve) => {
    releaseFont = resolve;
  });
  let enteredFont!: () => void;
  const fontReady = new Promise<void>((resolve) => {
    enteredFont = resolve;
  });
  const fetch = vi.fn(async () => ({
    ok: () => true,
    text: async () =>
      '<head><script id="nac-presentation-binding" type="application/json">{}</script></head>',
  }));
  let font!: Promise<void>;
  const document = f.route({
    request: () => assetRequest("/", "document"),
    fetch,
    fulfill: async () => {
      font = f.route({
        request: () => assetRequest("/assets/dist/missing.woff", "font"),
        abort: async () => {
          enteredFont();
          await fontGate;
        },
      } as unknown as Route);
    },
  } as unknown as Route);
  let settled = false;
  const disposal = f.serving
    .dispose()
    .catch((error: unknown) => error)
    .finally(() => {
      settled = true;
    });
  await fontReady;
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(f.unroute).not.toHaveBeenCalled();
  } finally {
    releaseFont();
  }
  const error = await disposal;
  await Promise.all([document, font]);
  expect(String(error)).toContain("no current fallback");
  expect(f.unroute).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
});

it("retains settled route rejection, unroute failure and the fail-closed error ledger", async () => {
  const f = await routedFixture();
  const abortFailure = new Error("abort failed"),
    unrouteFailure = new Error("unroute failed");
  const request = f.route({
    request: () => assetRequest("/assets/dist/missing.woff", "font"),
    abort: async () => {
      throw abortFailure;
    },
  } as unknown as Route);
  await expect(request).rejects.toBe(abortFailure);
  f.unroute.mockRejectedValueOnce(unrouteFailure);
  const error = await f.serving.dispose().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).cause).toBe(abortFailure);
  expect((error as AggregateError).errors.slice(0, 2)).toEqual([abortFailure, unrouteFailure]);
  expect(String((error as AggregateError).errors[2])).toContain("no current fallback");
  expect(f.unroute).toHaveBeenCalledOnce();
});
