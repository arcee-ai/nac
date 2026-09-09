import { test, type BrowserContext } from "@playwright/test";

import { createRemoteContexts, type RemoteContexts } from "./remote-auth";
import { RemoteGatewayDouble } from "./remote-gateway-double";

const noArtifacts = { trace: "off" as const, screenshot: "off" as const, video: "off" as const };
test.use(noArtifacts);

test.describe("remote managed authentication", () => {
  test("redeems one portal launch into a host-only owner context", async ({
    browser,
  }, testInfo) => {
    const gateway = await RemoteGatewayDouble.start();
    const artifactUse =
      process.env.NAC_E2E_REMOTE === "1" && process.env.NAC_E2E_REMOTE_AUTH_MODE === "portal-launch"
        ? testInfo.project.use
        : noArtifacts;
    let contexts: RemoteContexts | undefined;
    try {
      let redemptionError: unknown;
      try {
        await createRemoteContexts(browser, gateway.invalidPortalTarget(), {
          ignoreHTTPSErrors: true,
          artifactUse,
        });
      } catch (error) {
        redemptionError = error;
      }
      gateway.assertSanitizedError(redemptionError);

      const target = gateway.portalTarget();
      contexts = await createRemoteContexts(browser, target, {
        ignoreHTTPSErrors: true,
        artifactUse,
      });

      await requireStatus(
        contexts.authenticated,
        `${gateway.baseUrl}/healthz`,
        200,
        "owner cookie did not authenticate the managed host",
      );
      await requireStatus(
        contexts.anonymous,
        gateway.baseUrl,
        401,
        "cookie-free context reached the managed host",
      );
      await requireStatus(
        contexts.anonymous,
        target.authentication.mode === "portal-launch" ? target.authentication.launchUrl : "",
        401,
        "single-use launch URL replay was not denied",
      );
      await requireStatus(
        contexts.authenticated,
        `${gateway.wrongHostUrl}/healthz`,
        401,
        "owner cookie escaped to the wrong host",
      );

      const metadata = contexts.ownerCookie;
      if (
        metadata == null ||
        metadata.domain !== "127.0.0.1" ||
        metadata.path !== "/" ||
        !metadata.secure ||
        !metadata.httpOnly ||
        metadata.sameSite !== "Lax" ||
        !metadata.persistent
      ) {
        throw new Error("owner cookie metadata did not preserve the gateway security contract");
      }
      gateway.assertPortalExchange();
      await gateway.assertSecretsAbsentFromFiles(testInfo.outputDir);
    } finally {
      await closeContexts(contexts);
      await gateway.stop();
    }
  });

  test("preserves BasicAuth through the same context factory", async ({ browser }) => {
    const gateway = await RemoteGatewayDouble.start();
    let contexts: RemoteContexts | undefined;
    try {
      contexts = await createRemoteContexts(browser, gateway.basicTarget(), {
        ignoreHTTPSErrors: true,
      });
      await requireStatus(
        contexts.authenticated,
        `${gateway.baseUrl}/healthz`,
        200,
        "BasicAuth context did not authenticate the managed host",
      );
      await requireStatus(
        contexts.anonymous,
        gateway.baseUrl,
        401,
        "anonymous BasicAuth context reached the managed host",
      );
    } finally {
      await closeContexts(contexts);
      await gateway.stop();
    }
  });
});

async function requireStatus(
  context: BrowserContext,
  url: string,
  expected: number,
  failure: string,
): Promise<void> {
  let status: number;
  try {
    status = (await context.request.get(url, { maxRedirects: 0, timeout: 5_000 })).status();
  } catch {
    throw new Error("local gateway request failed without retaining authentication details");
  }
  if (status !== expected) throw new Error(failure);
}

async function closeContexts(contexts: RemoteContexts | undefined): Promise<void> {
  if (contexts == null) return;
  await Promise.allSettled([contexts.authenticated.close(), contexts.anonymous.close()]);
}
