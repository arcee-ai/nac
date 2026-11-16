import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createDirectSession, expect, test } from "./harness";

// Only exact previously built assets may be selected for the historical visual
// comparison. API/server ownership remains the same disposable harness. This
// characterizes browser presentation, never an app/WK or native-browser join.
const baselineAssets = process.env.NAC_TERMINAL_LINK_BASE_ASSETS;
async function baseline(page: import("@playwright/test").Page, origin: string) {
  if (!baselineAssets) return;
  origin = new URL(origin).origin;
  const root = await fs.realpath(baselineAssets);
  await page.route(
    (url) => url.origin === origin && url.pathname === "/",
    async (route) => {
      const response = await route.fetch();
      const current = await response.text();
      const binding = current.match(
        /<script id="nac-presentation-binding" type="application\/json">[\s\S]*?<\/script>/g,
      );
      if (binding?.length !== 1)
        throw new Error("Owned serving bootstrap unavailable for baseline");
      const html = (await fs.readFile(path.join(root, "index.html"), "utf8")).replace(
        "</head>",
        binding[0] + "</head>",
      );
      const headers = response.headers();
      delete headers["content-length"];
      delete headers["content-encoding"];
      await route.fulfill({ status: response.status(), headers, body: html });
    },
  );
  await page.route(
    (url) => url.origin === origin && url.pathname.startsWith("/assets/dist/"),
    async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const file = path.resolve(root, pathname.slice("/assets/dist/".length));
      if (!file.startsWith(root + path.sep))
        throw new Error("Asset path escaped the exact baseline");
      await route.fulfill({ path: file });
    },
  );
}

function octal(text: string) {
  return Array.from(
    new TextEncoder().encode(text),
    (byte) => "\\" + byte.toString(8).padStart(3, "0"),
  ).join("");
}

for (const width of [1440, 390]) {
  for (const mode of ["browser", "native-visible-anchor"] as const) {
    test(`${mode} terminal links preserve input and actual browser navigation at ${width}`, async ({
      harness,
      page,
      context,
      request,
    }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await baseline(page, harness.baseUrl);
      if (mode === "native-visible-anchor") {
        // Explicit presentation capability fixture. No URL/native operation is
        // exposed; this is not an authenticated native app or native authority.
        await page.addInitScript(() =>
          Object.defineProperty(globalThis, "__nacDesktop", {
            value: { connect: () => () => {} },
          }),
        );
      }
      let visits = 0;
      const server = createServer((req, res) => {
        if (req.url?.startsWith("/destination/")) visits += 1;
        res.setHeader("Content-Type", "text/html");
        res.end(
          "<!doctype html><title>Owned terminal link fixture</title><p>Terminal link reached its browser destination.</p>",
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Owned link fixture unavailable");
      const destinationOrigin = `http://127.0.0.1:${address.port}`;
      const destination =
        destinationOrigin + "/destination/FIXTURE_PATH?token=FIXTURE_QUERY#FIXTURE_FRAGMENT";
      const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
      let session: string | undefined;
      let terminal: string | undefined;
      let popup: import("@playwright/test").Page | undefined;
      let popupCount = 0;
      const opened = () => {
        popupCount += 1;
      };
      context.on("page", opened);
      const effectPaths: string[] = [];
      const observe = (req: import("@playwright/test").Request) => {
        const pathname = new URL(req.url()).pathname;
        if (req.method() === "POST" && /\/(?:input|input-control)$/.test(pathname))
          effectPaths.push(pathname);
      };
      try {
        session = await createDirectSession(request, harness);
        await page.goto(harness.baseUrl + "/#/session/" + session + "/terminal");
        const pane = page.getByRole("region", { name: "Session terminal", exact: true });
        if (width === 390)
          await page.getByRole("button", { name: "Open panel", exact: true }).click();
        else {
          const show = page.getByRole("button", { name: "Show panel", exact: true });
          await expect(show.or(pane)).toBeVisible();
          if (await show.isVisible()) await show.click();
        }
        await expect(pane).toBeVisible();
        await pane.getByRole("button", { name: /^New shell$/i }).click();
        await expect(pane.getByText("Connected", { exact: true })).toBeVisible();
        terminal = (await api.listUserTerminals(session)).terminals[0].terminal_id;
        const release = path.join(harness.runRoot, "workspace", "terminal-link-release");
        await pane.getByRole("region", { name: "Interactive terminal", exact: true }).click();
        const output =
          "\x1b[2J\x1b[H\x1b]8;;" + destination + "\x07LINK-CELL\x1b]8;;\x07\r\nLINK-READY\r\n";
        await page.keyboard.type(
          "printf '" +
            octal(output) +
            "'; while [ ! -e terminal-link-release ]; do read -r -t 1 ignored || :; done; printf 'LINK-OUTPUT\\n'",
        );
        await page.keyboard.press("Enter");
        await expect(pane.locator(".xterm-accessibility")).toContainText("LINK-READY");
        const runtimeId = await page.locator("[data-nac-runtime]").getAttribute("data-nac-runtime");
        const ownership = await api.getTerminalInputControl(session, terminal);
        const geometry = await api.getUserTerminal(session, terminal);
        const screen = await pane.locator(".xterm-screen").boundingBox();
        if (!screen) throw new Error("Actual terminal screen missing");
        const cell = {
          x: screen.x + (screen.width * 3) / geometry.cols,
          y: screen.y + (screen.height * 0.5) / geometry.rows,
        };
        const hover = async () => {
          // Move through a real non-link cell. Merely leaving the screen can
          // preserve xterm's last-cell cache and does not rediscover that cell.
          await page.mouse.move(cell.x, screen.y + (screen.height * 1.5) / geometry.rows);
          await page.mouse.move(cell.x, cell.y);
        };
        page.on("request", observe);
        await hover();
        const native = mode === "native-visible-anchor" && !baselineAssets;
        const link = pane.getByRole("link", {
          name: `Open terminal link in browser at ${destinationOrigin}; destination details hidden`,
          exact: true,
        });
        if (native) {
          await expect(link).toBeVisible();
          await expect(link).toHaveText("Open " + destinationOrigin + "/…");
          await expect(link).toHaveAttribute("href", destination);
          await expect(link).toHaveAttribute("target", "_blank");
          await expect(link).toHaveAttribute("rel", "noopener noreferrer");
          expect(
            await pane
              .locator(".xterm-helper-textarea")
              .evaluate((node) => node.ownerDocument.activeElement === node),
          ).toBe(true);
        } else await expect(pane.locator(".nac-terminal-link")).toHaveCount(0);
        const shot = info.outputPath("terminal-link-hover.png");
        await page.screenshot({ path: shot });
        await info.attach("production terminal hover", { path: shot, contentType: "image/png" });
        if (native) {
          await page.mouse.click(cell.x, cell.y);
          await expect(link).toBeFocused();
          expect(popupCount).toBe(0);
          expect(visits).toBe(0);
          await pane.getByRole("button", { name: "Close terminal link", exact: true }).click();
          await expect(link).toHaveCount(0);
          expect(
            await pane
              .locator(".xterm-helper-textarea")
              .evaluate((node) => node.ownerDocument.activeElement === node),
          ).toBe(true);
          await hover();
          await expect(link).toBeVisible();
          const stale = await link.elementHandle();
          if (!stale) throw new Error("Real link disappeared before lifetime control");
          await fs.writeFile(release, "release");
          await expect(pane.locator(".xterm-accessibility")).toContainText("LINK-OUTPUT");
          await expect(link).toHaveCount(0);
          expect(await stale.evaluate((node) => node.hasAttribute("href"))).toBe(false);
          await hover();
          await page.mouse.click(cell.x, cell.y);
          await expect(link).toBeFocused();
          const next = context.waitForEvent("page");
          if (width === 390) await link.click();
          else await link.press("Enter");
          popup = await next;
        } else {
          await fs.writeFile(release, "release");
          await expect(pane.locator(".xterm-accessibility")).toContainText("LINK-OUTPUT");
          const next = context.waitForEvent("page");
          await page.mouse.click(cell.x, cell.y);
          popup = await next;
        }
        await expect(popup).toHaveTitle("Owned terminal link fixture");
        expect(popup.url()).toBe(destination);
        // Playwright retains the originating Page for popup bookkeeping even
        // when noopener severs the destination's browser window relationship.
        expect(await popup.evaluate(() => Reflect.get(globalThis, "opener") === null)).toBe(true);
        expect(await popup.evaluate(() => Reflect.has(globalThis, "__nacDesktop"))).toBe(false);
        expect(popupCount).toBe(1);
        expect(visits).toBe(1);
        expect(effectPaths).toEqual([]);
        expect(await page.locator("[data-nac-runtime]").getAttribute("data-nac-runtime")).toBe(
          runtimeId,
        );
        expect(await api.getTerminalInputControl(session, terminal)).toMatchObject({
          controller: ownership.controller,
          revision: ownership.revision,
          frozen: ownership.frozen,
        });
        const permissions = await api.getPermissions(session);
        expect(permissions.requests).toEqual([]);
        expect(permissions.grants).toEqual([]);
        expect(harness.provider.requests).toHaveLength(0);
        const evidence = {
          mode,
          width,
          asset_source: baselineAssets ? "f5e6acb0-baseline" : "candidate-production",
          actual_chromium_popup: true,
          popup_count: popupCount,
          owned_destination_visits: visits,
          destination_origin: destinationOrigin,
          exact_href_checked: true,
          activation: native ? (width === 390 ? "anchor-click" : "anchor-enter") : "cell-click",
          zero_input_or_control_requests: true,
          native_wk_or_vendor_qualified: false,
        };
        await fs.writeFile(
          info.outputPath("terminal-link-evidence.json"),
          JSON.stringify(evidence, null, 2),
        );
      } finally {
        page.off("request", observe);
        context.off("page", opened);
        try {
          await popup?.close();
        } finally {
          try {
            if (terminal && session) await api.terminateTerminal(session, terminal);
          } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            );
          }
        }
      }
      harness.provider.assertConsumed();
    });
  }
}
