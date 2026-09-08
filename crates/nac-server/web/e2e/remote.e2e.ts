import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";

import { requireRemoteTarget } from "./remote-config";

type Readiness = {
  status?: unknown;
  managed?: unknown;
  version?: unknown;
  schema_version?: unknown;
};

type ManagedStatus = Readiness & {
  ready?: unknown;
  model_ready?: unknown;
};

const target = requireRemoteTarget();
let authenticated: APIRequestContext;
let anonymous: APIRequestContext;

test.beforeAll(async () => {
  authenticated = await playwrightRequest.newContext({
    baseURL: target.baseUrl,
    httpCredentials: { username: target.username, password: target.password, send: "always" },
  });
  anonymous = await playwrightRequest.newContext({ baseURL: target.baseUrl });
});

test.afterAll(async () => {
  await Promise.all([authenticated?.dispose(), anonymous?.dispose()].filter(Boolean));
});

test("denies an anonymous browser before it reaches owner-equivalent UI", async () => {
  const response = await anonymous.get("/", { maxRedirects: 0 });
  expect([401, 403]).toContain(response.status());
});

test("reports a responsive, ready managed host and records its release identity", async ({
  request,
}) => {
  void request;
  const testInfo = test.info();
  const health = await authenticated.get("/healthz");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: "ok" });

  const readiness = await getJson<Readiness>(authenticated, "/readyz");
  expect(readiness.status).toBe("ok");
  expect(readiness.managed).toBe(true);
  expect(readiness.version).toEqual(expect.any(String));
  expect(readiness.schema_version).toEqual(expect.any(Number));

  const managed = await getJson<ManagedStatus>(authenticated, "/managed/status");
  expect(managed.ready).toBe(true);
  expect(managed.model_ready).toBe(true);
  expect(managed.version).toBe(readiness.version);
  expect(managed.schema_version).toBe(readiness.schema_version);
  if (target.expectedVersion) expect(managed.version).toBe(target.expectedVersion);

  await testInfo.attach("remote release identity", {
    body: Buffer.from(
      JSON.stringify(
        {
          version: managed.version,
          schema_version: managed.schema_version,
          ready: managed.ready,
          model_ready: managed.model_ready,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
});

test("loads the production client through the authenticated gateway", async ({ browser }) => {
  const context = await browser.newContext({
    httpCredentials: { username: target.username, password: target.password, send: "always" },
  });
  const page = await context.newPage();
  try {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const response = await page.goto(target.baseUrl);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("NAC");
    await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  if (!response.ok()) throw new Error(`${path} returned ${response.status()}`);
  return (await response.json()) as T;
}
