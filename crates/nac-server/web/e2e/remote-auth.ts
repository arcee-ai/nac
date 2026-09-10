import type { Browser, BrowserContext, BrowserContextOptions, Cookie } from "@playwright/test";

import type { RemoteTarget } from "./remote-config";

const OWNER_COOKIE_NAME = "__Host-nac_session";
const PORTAL_REDEMPTION_FAILURE =
  "portal launch redemption failed without retaining authentication details";
const remoteFailureMessages = {
  "authentication-setup": "remote authentication setup failed without retaining target details",
  "anonymous-gateway-check": "anonymous gateway check failed without retaining target details",
  "readiness-and-identity":
    "managed readiness and identity check failed without retaining target details",
  "production-client": "production client check failed without retaining target details",
} as const;

export type SanitizedRemoteOperation = keyof typeof remoteFailureMessages;

export type RemoteArtifactUse = {
  trace?: unknown;
  screenshot?: unknown;
  video?: unknown;
  recordHar?: unknown;
  recordVideo?: unknown;
  recordVideoDir?: unknown;
};

export type OwnerCookieMetadata = {
  name: typeof OWNER_COOKIE_NAME;
  domain: string;
  path: "/";
  secure: true;
  httpOnly: true;
  sameSite: "Lax";
  persistent: true;
};

export type RemoteContexts = {
  authenticated: BrowserContext;
  anonymous: BrowserContext;
  ownerCookie?: OwnerCookieMetadata;
};

export type RemoteContextFactoryOptions = Pick<BrowserContextOptions, "ignoreHTTPSErrors"> & {
  artifactUse?: RemoteArtifactUse;
};

export function assertPortalArtifactSafety(target: RemoteTarget, use: RemoteArtifactUse): void {
  if (target.authentication.mode !== "portal-launch") return;
  const unsafe = [
    use.trace !== "off" ? "trace" : null,
    use.screenshot !== "off" ? "screenshot" : null,
    use.video !== "off" ? "video" : null,
    use.recordHar != null ? "HAR" : null,
    use.recordVideo != null ? "context video" : null,
    use.recordVideoDir != null ? "context video directory" : null,
  ].filter(Boolean);
  if (unsafe.length > 0) {
    throw new Error(
      `portal-launch remote E2E requires artifact recording to be disabled (${unsafe.join(", ")})`,
    );
  }
}

export async function sanitizedRemoteOperation<T>(
  operation: SanitizedRemoteOperation,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch {
    throw new Error(remoteFailureMessages[operation]);
  }
}

export async function createRemoteContexts(
  browser: Browser,
  target: RemoteTarget,
  options: RemoteContextFactoryOptions = {},
): Promise<RemoteContexts> {
  if (target.authentication.mode === "portal-launch") {
    assertPortalArtifactSafety(target, options.artifactUse ?? {});
  }
  const contextOptions: Pick<BrowserContextOptions, "ignoreHTTPSErrors"> = {
    ignoreHTTPSErrors: options.ignoreHTTPSErrors,
  };
  const authenticated = await browser.newContext({
    ...contextOptions,
    serviceWorkers: "block",
    ...(target.authentication.mode === "basic"
      ? {
          httpCredentials: {
            username: target.authentication.username,
            password: target.authentication.password,
            origin: target.baseUrl,
            send: "always" as const,
          },
        }
      : {}),
  });
  const anonymous = await browser.newContext({ ...contextOptions, serviceWorkers: "block" });

  try {
    const ownerCookie =
      target.authentication.mode === "portal-launch"
        ? await redeemPortalLaunch(authenticated, target)
        : undefined;
    return { authenticated, anonymous, ownerCookie };
  } catch {
    await Promise.allSettled([authenticated.close(), anonymous.close()]);
    throw new Error(PORTAL_REDEMPTION_FAILURE);
  }
}

async function redeemPortalLaunch(
  context: BrowserContext,
  target: RemoteTarget,
): Promise<OwnerCookieMetadata> {
  if (target.authentication.mode !== "portal-launch") {
    throw new Error(PORTAL_REDEMPTION_FAILURE);
  }
  const page = await context.newPage();
  try {
    const response = await page.goto(target.authentication.launchUrl, {
      waitUntil: "domcontentloaded",
    });
    const finalUrl = new URL(page.url());
    if (
      response?.status() !== 200 ||
      finalUrl.origin !== target.baseUrl ||
      finalUrl.pathname !== "/" ||
      finalUrl.search !== "" ||
      finalUrl.hash !== ""
    ) {
      throw new Error(PORTAL_REDEMPTION_FAILURE);
    }

    const browserVisibleCookies = await page.evaluate<string>("document.cookie");
    if (browserVisibleCookies.includes(`${OWNER_COOKIE_NAME}=`)) {
      throw new Error(PORTAL_REDEMPTION_FAILURE);
    }

    const cookies = await context.cookies(target.baseUrl);
    return ownerCookieMetadata(cookies, finalUrl.hostname);
  } catch {
    throw new Error(PORTAL_REDEMPTION_FAILURE);
  } finally {
    await page.close().catch(() => undefined);
  }
}

function ownerCookieMetadata(cookies: Cookie[], expectedHostname: string): OwnerCookieMetadata {
  const ownerCookies = cookies.filter((cookie) => cookie.name === OWNER_COOKIE_NAME);
  const cookie = ownerCookies[0];
  if (
    ownerCookies.length !== 1 ||
    cookie == null ||
    cookie.domain !== expectedHostname ||
    cookie.path !== "/" ||
    !cookie.secure ||
    !cookie.httpOnly ||
    cookie.sameSite !== "Lax" ||
    cookie.expires <= Date.now() / 1000
  ) {
    throw new Error(PORTAL_REDEMPTION_FAILURE);
  }
  return {
    name: OWNER_COOKIE_NAME,
    domain: cookie.domain,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
    persistent: true,
  };
}
