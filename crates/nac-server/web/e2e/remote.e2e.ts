import { expect, test, type APIRequestContext } from "@playwright/test";

import { createRemoteContexts, type RemoteContexts } from "./remote-auth";
import { requireRemoteTarget } from "./remote-config";

type ReleaseIdentity = {
  version?: unknown;
  schema_version?: unknown;
  product_version?: unknown;
  build_id?: unknown;
  build_track?: unknown;
  source_revision?: unknown;
  supported_schema_version?: unknown;
  minimum_migratable_schema_version?: unknown;
  opened_schema_version?: unknown;
  migration_state?: unknown;
  migration_failure?: unknown;
  maintenance_state?: unknown;
};

type Readiness = ReleaseIdentity & {
  status?: unknown;
  managed?: unknown;
};

type ManagedStatus = ReleaseIdentity & {
  managed?: unknown;
  ready?: unknown;
  model_ready?: unknown;
};

const target = requireRemoteTarget();
let contexts: RemoteContexts;

test.beforeAll(async ({ browser }, testInfo) => {
  contexts = await createRemoteContexts(browser, target, {
    artifactUse: testInfo.project.use,
  });
});

test.afterAll(async () => {
  if (!contexts) return;
  await Promise.allSettled([contexts.authenticated.close(), contexts.anonymous.close()]);
});

test("denies an anonymous browser before it reaches owner-equivalent UI", async () => {
  const response = await contexts.anonymous.request.get(target.baseUrl, { maxRedirects: 0 });
  expect([401, 403]).toContain(response.status());
});

test("reports a responsive, ready managed host and records its release identity", async () => {
  const request = contexts.authenticated.request;
  const testInfo = test.info();
  const health = await request.get(`${target.baseUrl}/healthz`);
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: "ok" });

  const readiness = await getJson<Readiness>(request, `${target.baseUrl}/readyz`);
  expect(readiness.status).toBe("ok");
  expect(readiness.managed).toBe(true);
  const requireExactIdentity = target.authentication.mode === "portal-launch";
  const readinessIdentity = requireReleaseIdentity(readiness, requireExactIdentity);

  const managed = await getJson<ManagedStatus>(request, `${target.baseUrl}/managed/status`);
  expect(managed.managed).toBe(true);
  expect(managed.ready).toBe(true);
  expect(managed.model_ready).toBe(true);
  const managedIdentity = requireReleaseIdentity(managed, requireExactIdentity);
  expect(managedIdentity).toEqual(readinessIdentity);
  if (target.expectedVersion) expect(managedIdentity.product_version).toBe(target.expectedVersion);

  await testInfo.attach("remote release identity", {
    body: Buffer.from(
      JSON.stringify(
        {
          ...managedIdentity,
          release_id: managedIdentity.build_id,
          release_digest_exposed: false,
          environment: target.environmentName,
          authentication_mode: target.authentication.mode,
          owner_cookie: contexts.ownerCookie
            ? {
                name: contexts.ownerCookie.name,
                host_only: true,
                path: contexts.ownerCookie.path,
                secure: contexts.ownerCookie.secure,
                http_only: contexts.ownerCookie.httpOnly,
                same_site: contexts.ownerCookie.sameSite,
                persistent: contexts.ownerCookie.persistent,
              }
            : null,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
});

test("loads the production client through the authenticated gateway", async () => {
  const page = await contexts.authenticated.newPage();
  try {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    const response = await page.goto(target.baseUrl);
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("NAC");
    await expect(page.getByRole("button", { name: "Open the menu" })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

function requireReleaseIdentity(value: ReleaseIdentity, requireExact: boolean) {
  expect(value.version).toEqual(expect.any(String));
  expect(value.schema_version).toEqual(expect.any(Number));
  if (!requireExact && value.product_version == null) {
    return {
      identity_contract: "legacy" as const,
      product_version: value.version as string,
      build_id: null,
      build_track: null,
      source_revision: null,
      schema_version: value.schema_version as number,
      supported_schema_version: null,
      minimum_migratable_schema_version: null,
      opened_schema_version: null,
      migration_state: null,
      maintenance_state: null,
    };
  }

  expect(value.product_version).toBe(value.version);
  expect(value.build_id).toEqual(expect.any(String));
  expect(value.build_track).toMatch(/^(dev|beta|stable)$/);
  expect(value.source_revision).toEqual(expect.any(String));
  expect(value.supported_schema_version).toBe(value.schema_version);
  expect(value.minimum_migratable_schema_version).toEqual(expect.any(Number));
  expect(value.opened_schema_version).toBe(value.schema_version);
  expect(value.migration_state).toBe("current");
  expect(value.migration_failure).toBeNull();
  expect(value.maintenance_state).toBe("serving");

  const identity = {
    identity_contract: "exact" as const,
    product_version: value.product_version as string,
    build_id: value.build_id as string,
    build_track: value.build_track as string,
    source_revision: value.source_revision as string,
    schema_version: value.schema_version as number,
    supported_schema_version: value.supported_schema_version as number,
    minimum_migratable_schema_version: value.minimum_migratable_schema_version as number,
    opened_schema_version: value.opened_schema_version as number,
    migration_state: value.migration_state as string,
    maintenance_state: value.maintenance_state as string,
  };
  expect(identity.product_version.length).toBeGreaterThan(0);
  expect(identity.build_id.length).toBeGreaterThan(0);
  expect(identity.source_revision.length).toBeGreaterThan(0);
  expect(identity.minimum_migratable_schema_version).toBeLessThanOrEqual(identity.schema_version);
  return identity;
}

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  if (!response.ok()) {
    const path = new URL(url).pathname;
    throw new Error(`${path} returned ${response.status()}`);
  }
  return (await response.json()) as T;
}
