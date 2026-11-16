import fs from "node:fs/promises";
import http from "node:http";
import type { Duplex } from "node:stream";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test as base } from "./harness";

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };
type Node = {
  textContent: string | null;
  parentElement: Node | null;
  getAttribute(name: string): string | null;
  getBoundingClientRect(): Box;
  querySelector(selector: string): Node | null;
  querySelectorAll(selector: string): ArrayLike<Node>;
  closest(selector: string): Node | null;
  contains(node: Node | null): boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getAnimations(options?: { subtree: boolean }): { playState: string }[];
};
type Style = {
  height: string;
  minHeight: string;
  width: string;
  minWidth: string;
  position: string;
  overflowX: string;
  overflowY: string;
  contain: string;
  flexWrap: string;
  paddingBottom: string;
};
type Guard = { environment: Record<string, string>; denied: string[] };

/** Blocks the retained binary's registry warm-up without forwarding any traffic. */
export const test = base.extend<{ f1Network: Guard }>({
  f1Network: async ({ baseURL: _baseURL }, use, info) => {
    const denied: string[] = [];
    const sockets = new Set<Duplex>();
    const server = http.createServer((request, response) => {
      denied.push(`${request.method} ${request.url}`);
      response.writeHead(403);
      response.end();
    });
    server.on("connect", (request, socket) => {
      denied.push(`CONNECT ${request.url}`);
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing local deny proxy");
    const proxy = `http://127.0.0.1:${address.port}`;
    const environment: Record<string, string> = {};
    for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]) {
      environment[name] = proxy;
      environment[name.toLowerCase()] = proxy;
    }
    environment.NO_PROXY = environment.no_proxy = "127.0.0.1,localhost,::1";
    try {
      await use({ environment, denied });
    } finally {
      await evidence(info, "loopback-egress-guard.json", {
        proxy,
        ownerPid: process.pid,
        denied,
        forwardsTraffic: false,
      });
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  serverEnvironment: async ({ f1Network }, use) => use(f1Network.environment),
});
export { expect };

export async function evidence(info: TestInfo, name: string, value: unknown) {
  await fs.writeFile(info.outputPath(name), JSON.stringify(value, null, 2));
  await info.attach(name, { body: JSON.stringify(value), contentType: "application/json" });
}

export async function loopbackOnly(page: Page) {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.route("**/mcp_library/library", (route) => route.fulfill({ json: { entries: [] } }));
}

export async function openList(page: Page) {
  await page.getByRole("button", { name: "Open the menu", exact: true }).click();
  await page.getByRole("button", { name: /^MCP servers/ }).click();
  return page.getByRole("dialog", { name: "MCP servers", exact: true });
}
export async function openDraft(list: Locator, page: Page) {
  await list.getByRole("button", { name: "Add server", exact: true }).click();
  const catalog = page.getByRole("dialog", { name: "Add server", exact: true });
  await catalog.getByRole("button", { name: "Custom", exact: true }).click();
  return page.getByRole("dialog", { name: "Custom server", exact: true });
}
export async function disabledDraft(form: Locator, name: string) {
  await form.getByRole("button", { name: "Stdio", exact: true }).click();
  await form.getByRole("textbox", { name: "Server name", exact: true }).fill(name);
  await form.getByRole("textbox", { name: "Command", exact: true }).fill("/disabled-f1-fixture");
  const enabled = form.getByRole("switch", { name: "Enabled", exact: true });
  if ((await enabled.getAttribute("aria-checked")) === "true") await enabled.click();
  await expect(enabled).toHaveAttribute("aria-checked", "false");
}

/** Wait for the real modal and its controls to stop moving before measuring. */
export async function settle(dialog: Locator, info: TestInfo, state: string) {
  await expect(dialog).toBeVisible();
  const settled = await dialog.evaluate(async (element) => {
    const root = element as unknown as Node;
    const b = globalThis as unknown as {
      document: { fonts: { ready: Promise<unknown> } };
      requestAnimationFrame(callback: () => void): number;
    };
    await b.document.fonts.ready;
    let previous = "";
    let stable = 0;
    for (let frame = 0; frame < 120; frame++) {
      await new Promise<void>((resolve) => b.requestAnimationFrame(resolve));
      const boxes = [root, ...Array.from(root.querySelectorAll("header,footer,button"))].map(
        (node) => {
          const r = node.getBoundingClientRect();
          return [r.x, r.y, r.width, r.height];
        },
      );
      const current = JSON.stringify(boxes);
      const moving = (root.parentElement ?? root)
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === "running");
      stable = !moving && current === previous ? stable + 1 : 0;
      if (stable >= 2) return { frames: frame + 1, boxes };
      previous = current;
    }
    throw new Error(`F1 modal geometry did not settle: ${previous}`);
  });
  await evidence(info, `f1-${state}-settled.json`, settled);
}

/** All targets in every state are retained before the first size oracle. */
export async function geometry(dialog: Locator, labels: string[]) {
  return dialog.evaluate((element, names) => {
    const root = element as unknown as Node;
    const browser = globalThis as unknown as {
      innerWidth: number;
      innerHeight: number;
      devicePixelRatio: number;
      getComputedStyle(node: Node): Style;
      document: { elementFromPoint(x: number, y: number): Node | null };
    };
    const box = (node: Node | null) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const style = (node: Node | null) => {
      if (!node) return null;
      const s = browser.getComputedStyle(node);
      return {
        height: s.height,
        minHeight: s.minHeight,
        width: s.width,
        minWidth: s.minWidth,
        position: s.position,
        flexWrap: s.flexWrap,
        paddingBottom: s.paddingBottom,
        overflowX: s.overflowX,
        overflowY: s.overflowY,
        contain: s.contain,
      };
    };
    const targets = names.map((label) => {
      const node = Array.from(root.querySelectorAll("button")).find(
        (candidate) =>
          (candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === label,
      );
      if (!node) throw new Error(`F1 target missing: ${label}`);
      const r = node.getBoundingClientRect();
      const clips = [];
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const s = browser.getComputedStyle(parent);
        if (
          /auto|scroll|hidden|clip/.test(s.overflowX + s.overflowY) ||
          s.contain.includes("paint")
        )
          clips.push({ box: box(parent), style: style(parent) });
      }
      return {
        label,
        rect: box(node)!,
        computed: style(node),
        wrapper: box(node.parentElement),
        wrapperComputed: style(node.parentElement),
        clips,
        centerHit: node.contains(
          browser.document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        ),
      };
    });
    const scrolling = Array.from(root.querySelectorAll("fieldset,div"))
      .filter((node) => /auto|scroll/.test(browser.getComputedStyle(node).overflowY))
      .map((node) => ({
        box: box(node),
        style: style(node),
        scrollTop: node.scrollTop,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
      }));
    return {
      viewport: {
        width: browser.innerWidth,
        height: browser.innerHeight,
        dpr: browser.devicePixelRatio,
      },
      card: box(root),
      consumer: box(root.closest("[data-nac-runtime]")),
      header: box(root.querySelector("header")),
      footer: box(root.querySelector("footer")),
      footerStyle: style(root.querySelector("footer")),
      targets,
      scrolling,
    };
  }, labels);
}
export type Geometry = Awaited<ReturnType<typeof geometry>>;

export async function capture(page: Page, info: TestInfo, name: string) {
  await page.evaluate(async () => {
    const b = globalThis as unknown as {
      document: { fonts: { ready: Promise<unknown> } };
      requestAnimationFrame(callback: () => void): number;
    };
    await b.document.fonts.ready;
    await new Promise<void>((resolve) =>
      b.requestAnimationFrame(() => b.requestAnimationFrame(resolve)),
    );
  });
  const cdp = await page.context().newCDPSession(page);
  const file = info.outputPath(`${name}.png`);
  try {
    const frame = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.writeFile(file, Buffer.from(frame.data, "base64"));
  } finally {
    await cdp.detach();
  }
  await info.attach(name, { path: file, contentType: "image/png" });
}
export function assertTargets(states: { state: string; geometry: Geometry }[]) {
  for (const { state, geometry: g } of states)
    for (const target of g.targets) {
      const r = target.rect;
      expect(r.height, `F1 ${state}/${target.label} height >=44`).toBeGreaterThanOrEqual(44);
      expect(r.width, `F1 ${state}/${target.label} width >=44`).toBeGreaterThanOrEqual(44);
      expect(r.x).toBeGreaterThanOrEqual(-1);
      expect(r.right).toBeLessThanOrEqual(g.viewport.width + 1);
      expect(r.y).toBeGreaterThanOrEqual(-1);
      expect(r.bottom).toBeLessThanOrEqual(g.viewport.height + 1);
      expect(r.x).toBeGreaterThanOrEqual(g.consumer!.x - 1);
      expect(r.right).toBeLessThanOrEqual(g.consumer!.right + 1);
      expect(r.y).toBeGreaterThanOrEqual(g.consumer!.y - 1);
      expect(r.bottom).toBeLessThanOrEqual(g.consumer!.bottom + 1);
      for (const clip of target.clips) {
        const box = clip.box!;
        const style = clip.style!;
        if (/auto|scroll|hidden|clip/.test(style.overflowX) || style.contain.includes("paint")) {
          expect(r.x).toBeGreaterThanOrEqual(box.x - 1);
          expect(r.right).toBeLessThanOrEqual(box.right + 1);
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowY) || style.contain.includes("paint")) {
          expect(r.y).toBeGreaterThanOrEqual(box.y - 1);
          expect(r.bottom).toBeLessThanOrEqual(box.bottom + 1);
        }
      }
      expect(target.centerHit, `F1 ${state}/${target.label} actual center hit`).toBe(true);
      if (g.footer) expect(Math.abs(g.footer.bottom - g.card!.bottom)).toBeLessThanOrEqual(1);
    }
}
