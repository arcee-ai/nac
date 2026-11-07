import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { Page } from "@playwright/test";
import { createProject, createSession, expect, test } from "./harness";
import {
  frontendHash,
  ownFrontendServing,
  sealFrontendAssets,
  serveFrontendAssets,
  type FrontendMap,
} from "./frontend-assets";
import {
  initializeComposedWorkspace,
  installComposedFixture,
  type ComposedFixture,
} from "./presentation-composed-fixture";
import {
  captureView,
  designView,
  inspectorView,
  launchView,
  managedView,
  seedReading,
  settingsView,
  type CaptureJourney,
} from "./presentation-capture-fixture";
import { startPackedPresentation } from "./packed-presentation-fixture";
import { openNameZoom } from "./session-name-zoom";
import { ownComposedCleanup, ownPackedCapturePage } from "./presentation-capture-page";
import { finishPresentation } from "./presentation-lifetime";

type CaptureManifest = {
  role: "aggregate-D" | "owning-527-baseline" | "owning-527-final" | "owning-527-modal-baseline";
  purpose?: "contained-settings";
  frontendSource: string;
  apiSource: string;
  apiBinarySha256: string;
  package: { path: string; sha256: string; integrity: string };
  frontend?: { directory: string; mapPath: string; mapSha256: string };
};
const manifestPath = process.env.NAC_PRESENTATION_BASELINE_MANIFEST;
const manifest = manifestPath
  ? (JSON.parse(await fs.readFile(manifestPath, "utf8")) as CaptureManifest)
  : undefined;
if (manifest) {
  assert(
    [
      "aggregate-D",
      "owning-527-baseline",
      "owning-527-final",
      "owning-527-modal-baseline",
    ].includes(manifest.role),
  );
  for (const hash of [manifest.frontendSource, manifest.apiSource])
    assert(/^[a-f0-9]{40}$/.test(hash));
  assert(/^[a-f0-9]{64}$/.test(manifest.apiBinarySha256));
}
const aggregate = manifest?.role === "aggregate-D";
const modalBaseline = manifest?.role === "owning-527-modal-baseline";
if (modalBaseline) {
  assert(manifest);
  assert.equal(manifest.purpose, "contained-settings");
}
test.use({
  orchestration: aggregate || modalBaseline ? "0" : "1",
  hasTouch: true,
  trace: "on",
  screenshot: "off",
  video: "off",
});
if (manifest)
  assert(!process.env.NAC_E2E_REMOTE, "Capture-only entry rejects any configured remote mode");

const transports = !manifest
  ? []
  : modalBaseline
    ? (["packed"] as const)
    : (["standalone", "packed"] as const);
const widths = modalBaseline ? [390] : aggregate ? [1440, 768, 390, 195] : [1440, 768, 390];
for (const transport of transports) {
  for (const width of widths) {
    const label = modalBaseline
      ? "owning-527 modal-baseline"
      : aggregate
        ? "aggregate-D"
        : `owning-527 ${manifest?.role === "owning-527-baseline" ? "baseline" : "final"}`;
    test(`capture-only ${label} ${transport} ${width}px`, async ({
      harness,
      request,
      page: defaultPage,
    }, info) => {
      test.setTimeout(180_000);
      assert(manifest);
      assert.equal(process.env.NAC_PRESENTATION_TARBALL, manifest.package.path);
      assert.equal(process.env.NAC_PRESENTATION_TARBALL_SHA256, manifest.package.sha256);
      assert.equal(frontendHash(await fs.readFile(harness.binaryPath)), manifest.apiBinarySha256);
      const tarball = await fs.readFile(manifest.package.path);
      assert.equal(frontendHash(tarball), manifest.package.sha256);
      assert.equal(
        `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
        manifest.package.integrity,
      );
      assert.equal(process.env.NAC_QUALIFICATION_SOURCE_REVISION, manifest.apiSource);
      const identity = await request.get(`${harness.baseUrl}/product-context`);
      expect(identity.ok()).toBe(true);
      const producer = (await identity.json()) as { build: { source_revision: string } };
      assert.equal(producer.build.source_revision, manifest.apiSource);
      const policy = await request.get(`${harness.baseUrl}/ui-config`);
      expect(policy.ok()).toBe(true);
      expect((await policy.json()).orchestration_enabled).toBe(!(aggregate || modalBaseline));
      let sealed: Awaited<ReturnType<typeof sealFrontendAssets>> | undefined;
      if (manifest.frontend) {
        const bytes = await fs.readFile(manifest.frontend.mapPath);
        assert.equal(frontendHash(bytes), manifest.frontend.mapSha256);
        sealed = await sealFrontendAssets(
          manifest.frontend.directory,
          JSON.parse(bytes.toString()) as FrontendMap,
        );
      } else {
        assert.equal(manifest.role, "owning-527-final", "Baseline frontend manifest is required");
        assert.equal(manifest.frontendSource, manifest.apiSource);
      }
      const sentinelProject =
        transport === "packed" || !aggregate ? await createProject(request, harness) : undefined;
      const sentinel = sentinelProject
        ? await createSession(request, harness, "direct", sentinelProject)
        : "";
      const selected =
        width === 195 || modalBaseline
          ? await createSession(
              request,
              harness,
              "direct",
              await createProject(request, harness, {
                name: "Composed qualification project",
                // Keep the selected packed project distinct from the Right sentinel's workspace.
                cwd:
                  transport === "packed"
                    ? await initializeComposedWorkspace(harness, true, width)
                    : undefined,
              }),
            )
          : sentinel;
      const initial = modalBaseline
        ? `/session/${selected}/files`
        : aggregate
          ? width === 195
            ? `/session/${selected}/files`
            : "/"
          : "/design";
      const packed =
        transport === "packed"
          ? await startPackedPresentation(harness, sentinel, {
              twoInstances: true,
              initialPaths: { Left: initial },
            })
          : undefined;
      const url = packed?.baseUrl ?? harness.baseUrl;
      const endpoint = packed ? `${url}/fixture-runtime` : harness.baseUrl;
      let boundary: ComposedFixture | undefined;
      const serving = ownFrontendServing();
      let zoom: Awaited<ReturnType<typeof openNameZoom>> | undefined;
      const errors: string[] = [],
        forbidden: string[] = [];
      const packedPage = ownPackedCapturePage(
        url,
        async (page, name) => {
          const close = page
            .getByRole("region", { name: `${name} presentation`, exact: true })
            .getByRole("button", { name: "Close packed runtime", exact: true });
          if (await close.isVisible()) await close.click();
        },
        async (page) => {
          await expect(page.locator("[data-nac-runtime]")).toHaveCount(0);
        },
      );
      const cleanup = ownComposedCleanup(() => boundary, packedPage, serving.dispose);
      const prepare = async (page: Page) => {
        if (packed) packedPage.retain(page);
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", async (route) => {
          const address = new URL(route.request().url());
          if (
            ["http:", "https:"].includes(address.protocol) &&
            !["localhost", "127.0.0.1", "[::1]"].includes(address.hostname)
          ) {
            forbidden.push(address.origin);
            return route.abort("blockedbyclient");
          }
          return route.fallback();
        });
        if (transport === "standalone" && sealed)
          serving.retain(
            await serveFrontendAssets(page, harness.baseUrl, sealed, [
              "/",
              "/design",
              /^\/session\/[^/]+\/files$/,
            ]),
          );
        boundary = await installComposedFixture(page, request, harness, endpoint, width);
        if (width === 195 || !aggregate) boundary.catalogGate.release();
      };
      const failures: unknown[] = [];
      try {
        let page = defaultPage;
        if (width === 195) {
          zoom = await openNameZoom(
            info,
            packed ? url : url + "/#" + initial,
            prepare,
            { width: 390, height: 1000 },
            cleanup.beforeContextClose,
          );
          page = zoom.page;
          // Playwright's trace:on also owns persistent contexts created during this test.
          expect(zoom.zoom).toBe(2);
        } else {
          await page.setViewportSize({ width, height: 1000 });
          await prepare(page);
          await page.goto(packed ? url : url + "/#" + initial);
        }
        assert(boundary);
        const root = packed
          ? page.getByRole("region", { name: "Left presentation", exact: true })
          : page.locator("[data-nac-runtime]");
        if (packed && (aggregate || modalBaseline)) {
          await page
            .getByRole("region", { name: "Right presentation", exact: true })
            .getByRole("combobox", { name: "Message", exact: true })
            .fill("Unrelated Right draft must remain unchanged");
          await page
            .getByRole("textbox", { name: "Host draft", exact: true })
            .fill("Unrelated host draft must remain unchanged");
        }
        const journey: CaptureJourney = {
          page,
          root,
          request,
          harness,
          fixture: boundary,
          width,
          info,
          notes: [],
          legacyFrontend: manifest.frontendSource === "481ee248f755461c6bee9c274963cb30ccd6b0aa",
        };
        const provenance = () => ({
          role: manifest.role,
          purpose: manifest.purpose,
          frontendSource: manifest.frontendSource,
          producer,
          apiSource: manifest.apiSource,
          apiBinarySha256: manifest.apiBinarySha256,
          package: manifest.package,
          peers: packed?.peerVersions,
          packedFontSha256: packed?.fontSha256,
          zoom: zoom?.zoom ?? 1,
          frontendMap: sealed?.manifestSha256,
          assetRequests: serving.current?.requests,
          bootstrapBindings: serving.current?.bindings,
        });
        const observed = new Set<string>();
        const capture = (name: string) => {
          observed.add(name);
          return captureView(journey, name, provenance());
        };
        if (modalBaseline) {
          // Seed the selected state without requiring the defective parent footer.
          // The Settings controls and final Context limit focus match runtime18.
          journey.notes.push(
            "View-only Settings draft: API-seeded project/session/reading; public Settings controls and Context limit focus, no old launch/cancel/save qualification.",
          );
          await seedReading(journey, selected);
          await settingsView(journey, () => capture("settings-draft"), true);
        } else if (!aggregate) {
          await designView(
            journey,
            manifest.role === "owning-527-baseline" ? "Buttons" : "Selected presentation journeys",
          );
          await capture("design-common-reasoning-successor");
        } else {
          let id = selected;
          if (width !== 195) {
            try {
              id = await launchView(journey, () => capture("launch-pending"));
            } catch (error) {
              journey.notes.push(`unreachable launch-pending: ${String(error)}`);
              if (!observed.has("launch-pending")) await capture("launch-pending-unreachable");
              throw error;
            }
          }
          await seedReading(journey, id);
          for (const [name, action] of [
            ["settings-draft", () => settingsView(journey, () => capture("settings-draft"))],
            ...(width === 195
              ? []
              : [
                  [
                    "managed-newer-draft",
                    () => managedView(journey, () => capture("managed-newer-draft")),
                  ],
                  [
                    "inspector-parent-return",
                    async () => {
                      await inspectorView(journey, id);
                      await capture("inspector-parent-return");
                    },
                  ],
                ]),
          ] as [string, () => Promise<void>][]) {
            try {
              await action();
            } catch (error) {
              journey.notes.push(`unreachable ${name}: ${String(error)}`);
              if (!observed.has(name)) await capture(`${name}-unreachable`);
              throw error;
            }
          }
        }
        expect(errors).toEqual([]);
        expect(forbidden).toEqual([]);
        harness.provider.assertConsumed();
        await info.attach("capture-boundary-ledger", {
          contentType: "application/json",
          body: JSON.stringify({
            ...provenance(),
            calls: boundary.calls,
            notes: journey.notes,
            errors,
            forbidden,
          }),
        });
      } catch (error) {
        failures.push(error);
      } finally {
        await finishPresentation(failures, [
          () => cleanup.dispose(),
          () => zoom?.context.close(),
          () => packed?.stop(),
        ]);
      }
    });
  }
}
