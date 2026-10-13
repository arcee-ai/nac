import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fixture = vi.hoisted(() => ({ root: "" }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => fixture.root } };
});

beforeEach(async () => {
  const os = await vi.importActual<typeof import("node:os")>("node:os");
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), "nac-artifact-isolation-"));
  vi.stubEnv("NAC_E2E_ARTIFACTS", undefined);
  vi.stubEnv("NAC_E2E_REMOTE", "0");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await fs.rm(fixture.root, { recursive: true, force: true });
});

async function configuredDirectory(): Promise<string> {
  vi.resetModules();
  const config = (await import("../playwright.config")).default;
  const directory = config.outputDir;
  if (typeof directory !== "string" || !directory.startsWith(fixture.root + path.sep)) {
    throw new Error("artifact fixture escaped its owned temporary directory");
  }
  return directory;
}

describe("Playwright artifact ownership", () => {
  test("starting another default run cannot remove a live fixture", async () => {
    const active = await configuredDirectory();
    const marker = path.join(active, "live-fixture", "store.db");
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, "active synthetic fixture");
    // Independent runners start with no inherited explicit artifact directory.
    vi.stubEnv("NAC_E2E_ARTIFACTS", undefined);
    const competing = await configuredDirectory();
    // Playwright clears its configured output directory before executing tests.
    await fs.rm(competing, { recursive: true, force: true });
    expect(await fs.readFile(marker, "utf8")).toBe("active synthetic fixture");
    expect(competing).not.toBe(active);
  });

  test("workers reuse the directory selected by their parent runner", async () => {
    const parent = await configuredDirectory();
    expect(await configuredDirectory()).toBe(parent);
  });

  test("preserves an explicitly selected artifact directory", async () => {
    const selected = path.join(fixture.root, "selected-artifacts");
    vi.stubEnv("NAC_E2E_ARTIFACTS", selected);
    expect(await configuredDirectory()).toBe(selected);
    expect(await configuredDirectory()).toBe(selected);
  });
});
