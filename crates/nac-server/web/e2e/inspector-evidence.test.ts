import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, type Route } from "@playwright/test";
import { afterEach, expect, test, vi } from "vitest";

import { serveInspectorVersion } from "./inspector-evidence";

type Handler = (route: Route) => Promise<unknown>;

function inertPage(url = "about:blank") {
  const routes: { match: string | ((url: URL) => boolean); handle: Handler }[] = [];
  const page = {
    url: () => url,
    route: async (match: (typeof routes)[number]["match"], handle: Handler) => {
      routes.push({ match, handle });
    },
  } as unknown as Page;
  return { page, routes };
}

function inertRequest(url: string) {
  const abort = vi.fn(async () => {});
  const fulfill = vi.fn(async (_response: object) => {});
  const proceed = vi.fn(async () => {});
  const route = {
    request: () => ({ url: () => url }),
    abort,
    fulfill,
    continue: proceed,
  } as unknown as Route;
  return { route, abort, fulfill, proceed };
}

const roots: string[] = [];
const baseUrl = "http://127.0.0.1:3210";
const candidateAssets = fileURLToPath(new URL("../../assets/dist/assets/", import.meta.url));

async function baseline() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-inspector-assets-"));
  roots.push(root);
  await fs.mkdir(path.join(root, "assets"));
  await fs.writeFile(path.join(root, "index.html"), "baseline document");
  await fs.writeFile(path.join(root, "assets/baseline-only-fixture.js"), "baseline chunk");
  vi.stubEnv("NAC_INSPECTOR_BASELINE_DIST", root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("seals a page once and rejects binding an already bootstrapped document", async () => {
  await baseline();
  const { page, routes } = inertPage();
  await serveInspectorVersion(page, baseUrl, "before");
  await expect(serveInspectorVersion(page, baseUrl, "after")).rejects.toThrow("already sealed");
  expect(routes).toHaveLength(2);
  const loaded = inertPage(baseUrl);
  await expect(serveInspectorVersion(loaded.page, baseUrl, "before")).rejects.toThrow(
    "before first navigation",
  );
  expect(loaded.routes).toHaveLength(0);
});

test("both page versions reject the opposite revision's chunk without fallback", async () => {
  await baseline();
  const candidateChunk = (await fs.readdir(candidateAssets)).find((name) =>
    /^markdown-renderer-.*\.js$/.test(name),
  );
  expect(candidateChunk).toBeDefined();
  const before = inertPage();
  const after = inertPage();
  await serveInspectorVersion(before.page, baseUrl, "before");
  await serveInspectorVersion(after.page, baseUrl, "after");
  for (const [owner, foreign] of [
    [before, candidateChunk],
    [after, "baseline-only-fixture.js"],
  ] as const) {
    const request = inertRequest(`${baseUrl}/assets/dist/assets/${foreign}`);
    await owner.routes[0].handle(request.route);
    expect(request.abort).toHaveBeenCalledWith("failed");
    expect(request.fulfill).not.toHaveBeenCalled();
    expect(request.proceed).not.toHaveBeenCalled();
  }
  const normal = inertRequest(`${baseUrl}/assets/dist/assets/${candidateChunk}`);
  await after.routes[0].handle(normal.route);
  expect(normal.proceed).toHaveBeenCalledOnce();
  expect(normal.fulfill).not.toHaveBeenCalled();
});

test("queued baseline HTML and chunk requests retain their captured root across another page", async () => {
  const original = await baseline();
  const before = inertPage();
  await serveInspectorVersion(before.page, baseUrl, "before");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const realAccess = fs.access;
  vi.spyOn(fs, "access").mockImplementation(async (file, mode) => {
    if (file === path.join(original, "assets/baseline-only-fixture.js")) await waiting;
    return realAccess(file, mode);
  });
  const queued = inertRequest(`${baseUrl}/assets/dist/assets/baseline-only-fixture.js`);
  const pending = before.routes[0].handle(queued.route);
  try {
    const replacement = await baseline();
    await fs.writeFile(path.join(replacement, "index.html"), "wrong document");
    await fs.writeFile(path.join(replacement, "assets/baseline-only-fixture.js"), "wrong chunk");
    const after = inertPage();
    await serveInspectorVersion(after.page, baseUrl, "after");
    const document = inertRequest(`${baseUrl}/`);
    await before.routes[1].handle(document.route);
    expect(document.fulfill).toHaveBeenCalledWith({
      body: Buffer.from("baseline document"),
      contentType: "text/html",
    });
  } finally {
    release();
    await pending;
  }
  expect(queued.fulfill).toHaveBeenCalledWith({
    body: Buffer.from("baseline chunk"),
    contentType: "application/javascript",
  });
  expect(queued.proceed).not.toHaveBeenCalled();
});

test("a missing before asset root never silently becomes candidate routing", async () => {
  vi.stubEnv("NAC_INSPECTOR_BASELINE_DIST", "");
  const { page, routes } = inertPage();
  await expect(serveInspectorVersion(page, baseUrl, "before")).rejects.toThrow(
    "Baseline inspector assets are required",
  );
  expect(routes).toHaveLength(0);
});
