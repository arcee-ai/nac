import assert from "node:assert/strict";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { finishPresentation, PresentationTasks } from "./presentation-lifetime";

export type FrontendMap = Record<string, { mode: number; size: number; sha256: string }>;
export type SealedFrontend = { directory: string; files: FrontendMap; manifestSha256: string };
export const frontendHash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

function assetName(name: string) {
  assert(name && !name.includes("\\") && !name.includes("%"), "Noncanonical frontend path");
  assert(
    !path.isAbsolute(name) &&
      name.split("/").every((part) => part && part !== "." && part !== ".."),
    "Frontend path escapes root",
  );
  return name;
}

async function readFile(directory: string, name: string) {
  const file = path.join(directory, assetName(name));
  const real = await fs.realpath(file);
  assert(real === file && real.startsWith(directory + path.sep), "Frontend symlink or escape");
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert(stat.isFile(), "Frontend entry is not a regular file");
    return { bytes: await handle.readFile(), mode: stat.mode & 0o777 };
  } finally {
    await handle.close();
  }
}

/** Seal normal build bytes once; requests must keep matching this complete inventory. */
export async function sealFrontendAssets(
  directory: string,
  expected?: FrontendMap,
): Promise<SealedFrontend> {
  directory = await fs.realpath(directory);
  const files: FrontendMap = {};
  async function visit(prefix: string) {
    for (const entry of await fs.readdir(path.join(directory, prefix), { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(name + "/");
      else {
        assert(entry.isFile(), "Frontend inventory contains a symlink/non-file");
        const { bytes, mode } = await readFile(directory, name);
        files[name] = { mode, size: bytes.length, sha256: frontendHash(bytes) };
      }
    }
  }
  await visit("");
  assert(files["index.html"], "Missing frontend index");
  if (expected) assert.deepEqual(files, expected, "Normal frontend inventory drift");
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { directory, files: sorted, manifestSha256: frontendHash(JSON.stringify(sorted)) };
}

export async function readSealedFrontend(sealed: SealedFrontend, name: string) {
  assetName(name);
  const expected = sealed.files[name];
  assert(expected, `Unlisted frontend asset: ${name}`);
  const actual = await readFile(sealed.directory, name);
  assert.equal(actual.mode, expected.mode, "Frontend mode drift");
  assert.equal(actual.bytes.length, expected.size, "Frontend size drift");
  assert.equal(frontendHash(actual.bytes), expected.sha256, "Frontend hash drift");
  return actual.bytes;
}

/** Only the genuine API-issued bootstrap crosses into the preserved HTML template. */
export function bindFrontendDocument(template: string, live: string) {
  const pattern =
    /<script id="nac-presentation-binding" type="application\/json">([\s\S]*?)<\/script>/g;
  const bindings = [...live.matchAll(pattern)];
  assert.equal(bindings.length, 1, "Expected exactly one live API bootstrap binding");
  assert(!template.includes('id="nac-presentation-binding"'), "Baseline template already bound");
  assert.equal(template.split("</head>").length, 2, "Expected one template head");
  JSON.parse(bindings[0][1]);
  return {
    html: template.replace("</head>", () => bindings[0][0] + "</head>"),
    bindingSha256: frontendHash(bindings[0][0]),
  };
}

/** No asset miss can fall through to the current producer's embedded frontend. */
export async function serveFrontendAssets(
  page: Page,
  baseUrl: string,
  sealed: SealedFrontend,
  documents: (string | RegExp)[] = ["/"],
) {
  const origin = new URL(baseUrl).origin;
  const requests: { path: string; sha256: string }[] = [];
  const bindings: string[] = [],
    errors: string[] = [];
  const tasks = new PresentationTasks();
  const isDocument = (name: string) =>
    documents.some((entry) => (typeof entry === "string" ? entry === name : entry.test(name)));
  const match = (url: URL) => url.origin === origin;
  const handler = (route: Route) => {
    const task = (async () => {
      try {
        const request = route.request(),
          url = new URL(request.url());
        const type = request.resourceType();
        if (
          !isDocument(url.pathname) &&
          !url.pathname.startsWith("/assets/") &&
          ["fetch", "xhr", "eventsource"].includes(type)
        )
          return route.fallback();
        assert.equal(request.method(), "GET", "Frontend serving accepts GET only");
        assert(
          isDocument(url.pathname) || url.pathname.startsWith("/assets/dist/"),
          "Unlisted frontend resource path",
        );
        if (isDocument(url.pathname)) {
          const template = (await readSealedFrontend(sealed, "index.html")).toString();
          const live = await route.fetch();
          assert(live.ok(), "Live bootstrap document failed");
          const document = bindFrontendDocument(template, await live.text());
          bindings.push(document.bindingSha256);
          requests.push({ path: "index.html", sha256: frontendHash(template) });
          await route.fulfill({ body: document.html, contentType: "text/html" });
        } else {
          const name = url.pathname.slice("/assets/dist/".length);
          const bytes = await readSealedFrontend(sealed, name);
          requests.push({ path: name, sha256: frontendHash(bytes) });
          const extension = path.extname(name);
          const mime: Record<string, string> = {
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".ttf": "font/ttf",
            ".svg": "image/svg+xml",
            ".png": "image/png",
            ".ico": "image/x-icon",
          };
          await route.fulfill({
            body: bytes,
            contentType: mime[extension] ?? "application/octet-stream",
          });
        }
      } catch (error) {
        errors.push(String(error));
        await route.abort("failed");
      }
    })();
    return tasks.track(task);
  };
  await page.route(match, handler);
  return {
    requests,
    bindings,
    errors,
    dispose: async () => {
      await finishPresentation(
        [],
        [
          () => tasks.drain(),
          () => page.unroute(match, handler),
          () => tasks.drain(),
          () =>
            assert.deepEqual(
              errors,
              [],
              "Preserved frontend request failed; no current fallback allowed",
            ),
        ],
      );
    },
  };
}

/** Claim one page's sealed routes before awaiting disposal, including zoom startup failure. */
export function ownFrontendServing() {
  let serving: Awaited<ReturnType<typeof serveFrontendAssets>> | undefined;
  return {
    get current() {
      return serving;
    },
    retain(value: Awaited<ReturnType<typeof serveFrontendAssets>>) {
      assert(!serving, "Frontend serving already owned");
      serving = value;
    },
    async dispose() {
      const owned = serving;
      serving = undefined;
      await owned?.dispose();
    },
  };
}
