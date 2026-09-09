import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  assertPortalDebuggingDisabled,
  remoteArtifactPolicy,
  remoteTarget,
  requireRemoteTarget,
} from "./remote-config";
import { assertPortalArtifactSafety } from "./remote-auth";

describe("remote E2E configuration", () => {
  test("keeps the remote lane disabled without a target", () => {
    expect(remoteTarget({})).toBeNull();
    expect(() => requireRemoteTarget({})).toThrow("NAC_E2E_REMOTE_URL is required");
  });

  test("keeps BasicAuth as the backward-compatible default", () => {
    expect(
      remoteTarget({
        NAC_E2E_REMOTE_URL: "https://managed.example.test/",
        NAC_E2E_REMOTE_USERNAME: "owner",
        NAC_E2E_REMOTE_PASSWORD: "private-value",
        NAC_E2E_REMOTE_EXPECTED_VERSION: "0.1.3",
      }),
    ).toEqual({
      baseUrl: "https://managed.example.test",
      authentication: { mode: "basic", username: "owner", password: "private-value" },
      environmentName: "remote",
      expectedVersion: "0.1.3",
    });
  });

  test("loads portal launch authentication only from the explicit runtime mode", () => {
    const launchTicket = randomBytes(32).toString("base64url");
    const target = remoteTarget({
      NAC_E2E_REMOTE_URL: "https://managed.example.test",
      NAC_E2E_REMOTE_AUTH_MODE: "portal-launch",
      NAC_E2E_REMOTE_LAUNCH_URL: managedLaunchUrl(launchTicket),
      NAC_E2E_REMOTE_ENVIRONMENT: "dev2-isolated",
    });
    if (
      target?.baseUrl !== "https://managed.example.test" ||
      target.authentication.mode !== "portal-launch" ||
      target.authentication.launchUrl !== managedLaunchUrl(launchTicket) ||
      target.environmentName !== "dev2-isolated" ||
      target.expectedVersion !== undefined
    ) {
      throw new Error("portal launch configuration did not preserve its typed runtime inputs");
    }
  });

  test.each([
    "http://managed.example.test",
    "https://owner:secret@managed.example.test",
    "https://managed.example.test?credential=secret",
    "https://managed.example.test/#credential",
    "https://managed.example.test/nac",
  ])("rejects an unsafe remote URL: %s", (url) => {
    expect(() =>
      remoteTarget({
        NAC_E2E_REMOTE_URL: url,
        NAC_E2E_REMOTE_USERNAME: "owner",
        NAC_E2E_REMOTE_PASSWORD: "private-value",
      }),
    ).toThrow();
  });

  test.each(["NAC_E2E_REMOTE_USERNAME", "NAC_E2E_REMOTE_PASSWORD"])(
    "requires %s in BasicAuth mode",
    (missing) => {
      const environment: NodeJS.ProcessEnv = {
        NAC_E2E_REMOTE_URL: "https://managed.example.test",
        NAC_E2E_REMOTE_USERNAME: "owner",
        NAC_E2E_REMOTE_PASSWORD: "private-value",
      };
      delete environment[missing];
      expect(() => remoteTarget(environment)).toThrow(`${missing} is required`);
    },
  );

  test("rejects credentials from the other authentication mode", () => {
    const launchTicket = randomBytes(32).toString("base64url");
    expect(() =>
      remoteTarget({
        NAC_E2E_REMOTE_URL: "https://managed.example.test",
        NAC_E2E_REMOTE_USERNAME: "owner",
        NAC_E2E_REMOTE_PASSWORD: "private-value",
        NAC_E2E_REMOTE_LAUNCH_URL: managedLaunchUrl(launchTicket),
      }),
    ).toThrow("NAC_E2E_REMOTE_LAUNCH_URL is not allowed in basic");
    expect(() =>
      remoteTarget({
        NAC_E2E_REMOTE_URL: "https://managed.example.test",
        NAC_E2E_REMOTE_AUTH_MODE: "portal-launch",
        NAC_E2E_REMOTE_LAUNCH_URL: managedLaunchUrl(launchTicket),
        NAC_E2E_REMOTE_USERNAME: "owner",
      }),
    ).toThrow("NAC_E2E_REMOTE_USERNAME is not allowed in portal-launch");
  });

  test.each([
    (ticket: string) => `http://managed.example.test/__managed/launch?ticket=${ticket}`,
    (ticket: string) => `https://owner@managed.example.test/__managed/launch?ticket=${ticket}`,
    (ticket: string) => `https://managed.example.test/__managed/launch?ticket=${ticket}#fragment`,
    (ticket: string) => `https://other.example.test/__managed/launch?ticket=${ticket}`,
    (ticket: string) => `https://managed.example.test/wrong?ticket=${ticket}`,
    () => "https://managed.example.test/__managed/launch",
    (ticket: string) => `https://managed.example.test/__managed/launch?ticket=${ticket.slice(1)}`,
    (ticket: string) => `https://managed.example.test/__managed/launch?ticket=${ticket}&next=/`,
  ])("rejects unsafe portal launch URLs without echoing their values", (launchUrl) => {
    const launchTicket = randomBytes(32).toString("base64url");
    const rawLaunchUrl = launchUrl(launchTicket);
    let message = "";
    try {
      remoteTarget({
        NAC_E2E_REMOTE_URL: "https://managed.example.test",
        NAC_E2E_REMOTE_AUTH_MODE: "portal-launch",
        NAC_E2E_REMOTE_LAUNCH_URL: rawLaunchUrl,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    if (!message || message.includes(launchTicket) || message.includes(rawLaunchUrl)) {
      throw new Error("portal launch validation exposed runtime secret input");
    }
  });

  test("disables all automatic Playwright artifacts only for remote portal launch mode", () => {
    expect(
      remoteArtifactPolicy({
        NAC_E2E_REMOTE: "1",
        NAC_E2E_REMOTE_AUTH_MODE: "portal-launch",
      }),
    ).toEqual({ trace: "off", screenshot: "off", video: "off" });
    expect(remoteArtifactPolicy({ NAC_E2E_REMOTE: "1" })).toEqual({
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
      video: "retain-on-failure",
    });
  });

  test("accepts only bounded non-secret environment labels", () => {
    expect(() =>
      remoteTarget({
        NAC_E2E_REMOTE_URL: "https://managed.example.test",
        NAC_E2E_REMOTE_USERNAME: "owner",
        NAC_E2E_REMOTE_PASSWORD: "private-value",
        NAC_E2E_REMOTE_ENVIRONMENT: "dev2 label with spaces",
      }),
    ).toThrow("must be a short non-secret label");
  });

  test("fails closed if any portal context artifact recorder remains configured", () => {
    const launchTicket = randomBytes(32).toString("base64url");
    const target = remoteTarget({
      NAC_E2E_REMOTE_URL: "https://managed.example.test",
      NAC_E2E_REMOTE_AUTH_MODE: "portal-launch",
      NAC_E2E_REMOTE_LAUNCH_URL: managedLaunchUrl(launchTicket),
    });
    if (target == null) throw new Error("portal target was unexpectedly disabled");
    for (const unsafe of [
      { trace: "retain-on-failure", screenshot: "off", video: "off" },
      { trace: "off", screenshot: "only-on-failure", video: "off" },
      { trace: "off", screenshot: "off", video: "retain-on-failure" },
      { trace: "off", screenshot: "off", video: "off", recordHar: {} },
    ]) {
      expect(() => assertPortalArtifactSafety(target, unsafe)).toThrow(
        "requires artifact recording to be disabled",
      );
    }
  });

  test("accepts controller-shaped runtime tickets without retaining them in diagnostics", () => {
    for (let index = 0; index < 32; index += 1) {
      const launchTicket = randomBytes(32).toString("base64url");
      const target = remoteTarget({
        NAC_E2E_REMOTE_URL: "https://managed.example.test",
        NAC_E2E_REMOTE_AUTH_MODE: "portal-launch",
        NAC_E2E_REMOTE_LAUNCH_URL: managedLaunchUrl(launchTicket),
      });
      if (
        target?.authentication.mode !== "portal-launch" ||
        !target.authentication.launchUrl.endsWith(launchTicket)
      ) {
        throw new Error("controller-shaped launch URL did not round-trip through configuration");
      }
    }
  });

  test("fails closed when Playwright debugging could print a launch URL", () => {
    for (const environment of [
      { NAC_E2E_REMOTE_AUTH_MODE: "portal-launch", DEBUG: "pw:api" },
      { NAC_E2E_REMOTE_AUTH_MODE: "portal-launch", PWDEBUG: "1" },
    ]) {
      expect(() => assertPortalDebuggingDisabled(environment)).toThrow(
        "requires DEBUG and PWDEBUG to be unset",
      );
    }
  });
});

function managedLaunchUrl(ticket: string): string {
  return `https://managed.example.test/__managed/launch?ticket=${ticket}`;
}
