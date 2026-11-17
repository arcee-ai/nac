import { test, expect } from "./fixture";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { SESSION_PANELS } from "../../../crates/nac-server/web/src/app/lib/routes";

test("normal packaged source, launch identity and private canonical store agree", async ({
  candidate: c,
}) => {
  test.skip(!process.env.NAC_ELECTRON_APP, "Exact package provenance requires the packaged lane");
  const resources = path.join(process.env.NAC_ELECTRON_APP!, "Contents/Resources");
  const manifest = JSON.parse(await fs.readFile(path.join(resources, "manifest.json"), "utf8"));
  const state = await c.app.evaluate(({ app }) =>
    process
      .getBuiltinModule("module")
      .createRequire(app.getAppPath() + "/package.json")(app.getAppPath())
      .getState(),
  );
  expect(state.receipt.identity).toEqual(manifest.engine_identity);
  expect(state.receipt.identity.source_revision).toBe(manifest.sourceRevision);
  expect(state.receipt.identity.build_id).not.toMatch(/^native-auth-fixture-/);
  expect(state.receipt.schema).toBe(manifest.schema);
  expect(state.receipt.store).toBe(await fs.realpath(path.join(c.directory, "store.db")));
  expect(state.receipt.endpoint).toBe(c.endpoint);
  expect(state.receipt.incarnation).toMatch(/^[a-f0-9-]{36}$/);
  expect(
    createHash("sha256")
      .update(await fs.readFile(path.join(resources, "nac-web")))
      .digest("hex"),
  ).toBe(manifest.engineSha256);
  expect(
    createHash("sha256")
      .update(await fs.readFile(path.join(resources, "checkpoint-helper")))
      .digest("hex"),
  ).toBe(manifest.checkpointHelperSha256);
  if (process.env.NAC_ELECTRON_CI_SHA)
    expect(manifest.sourceRevision).toBe(process.env.NAC_ELECTRON_CI_SHA);
});

test("current session panel deep links retain the actual shared workspace", async ({
  candidate: c,
}) => {
  const project = await c.project();
  const direct = await c.session("direct", project);
  const orchestrator = await c.session("orchestrator", project);
  for (const panel of SESSION_PANELS) {
    const session = panel === "worksets" ? orchestrator : direct;
    await c.page.evaluate((route) => {
      location.hash = route;
    }, `/session/${session}/${panel}`);
    await expect(c.page.getByRole("combobox", { name: "Message" })).toBeVisible();
    // Legacy Threads/Sessions resolve to Insights. Worksets belongs to the
    // orchestrator; delegated/terminal/heartbeats belong to the direct session.
    const resolved = ["threads", "sessions"].includes(panel) ? "insights" : panel;
    await expect(c.page).toHaveURL(new RegExp(`/session/${session}/${resolved}$`));
    expect(
      await c.page.evaluate(() => ({
        node: typeof (window as any).process,
        require: typeof (window as any).require,
      })),
    ).toEqual({ node: "undefined", require: "undefined" });
  }
  // Route admission only: workflows inside these panels remain separately
  // inventoried; an empty panel is not Git/goal/schedule/topology acceptance.
});
