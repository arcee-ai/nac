import { describe, expect, test } from "vitest";

import { remoteTarget, requireRemoteTarget } from "./remote-config";

describe("remote E2E configuration", () => {
  test("keeps the remote lane disabled without a target", () => {
    expect(remoteTarget({})).toBeNull();
    expect(() => requireRemoteTarget({})).toThrow("NAC_E2E_REMOTE_URL is required");
  });

  test("loads an authenticated HTTPS target without putting credentials in the URL", () => {
    expect(
      remoteTarget({
        NAC_E2E_REMOTE_URL: "https://managed.example.test/",
        NAC_E2E_REMOTE_USERNAME: "owner",
        NAC_E2E_REMOTE_PASSWORD: "private-value",
        NAC_E2E_REMOTE_EXPECTED_VERSION: "0.1.3",
      }),
    ).toEqual({
      baseUrl: "https://managed.example.test",
      username: "owner",
      password: "private-value",
      expectedVersion: "0.1.3",
    });
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
    "requires %s when a target is enabled",
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
});
