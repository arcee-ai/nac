import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./harness";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = await fs.readFile(
  path.join(repository, "desktop/macos/DeviceAuthSmoke.swift"),
  "utf8",
);
const script = source.match(/static let clickScript = #"""([\s\S]*?)"""#/);
if (!script) throw new Error("Missing actual native device-auth click script");
const click = new Function("input", `const { title, inCard } = input; ${script[1]!}`) as (input: {
  title: string;
  inCard: boolean;
}) => boolean;

test("native device fixture waits for the auth check before issuing one sign-in", async ({
  page,
  harness,
}) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let loginRequests = 0;
  await page.route("**/auth", async (route) => {
    const response = await route.fetch();
    await released;
    await route.fulfill({ response });
  });
  await page.route("**/auth/arcee/login", async (route) => {
    loginRequests++;
    // Keep this readiness regression local; no vendor authentication is started.
    await route.fulfill({ status: 503, json: { error: "Local fixture stopped sign-in" } });
  });
  try {
    await page.goto(`${harness.baseUrl}/#/`);
    await page.getByRole("button", { name: "Get Started", exact: true }).click();
    await page.getByRole("button", { name: "Provider connections", exact: true }).click();
    const accounts = page.getByRole("region", { name: "Provider connections", exact: true });
    await expect(accounts.getByText("Arcee sign-in", { exact: true })).toBeVisible();
    await expect(accounts.getByText("Checking connection…", { exact: true }).first()).toBeVisible();
    const input = { title: "Sign in with Arcee", inCard: true };
    expect(await page.evaluate(click, input)).toBe(false);
    expect(loginRequests).toBe(0);
    release();
    await expect.poll(() => page.evaluate(click, input)).toBe(true);
    await expect(accounts.getByRole("alert")).toContainText("provider returned a server error");
    expect(loginRequests).toBe(1);
    harness.provider.assertConsumed();
  } finally {
    release();
  }
});
