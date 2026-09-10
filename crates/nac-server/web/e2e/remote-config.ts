export type RemoteAuthentication =
  | {
      mode: "basic";
      username: string;
      password: string;
    }
  | {
      mode: "portal-launch";
      launchUrl: string;
    };

export type RemoteTarget = {
  baseUrl: string;
  authentication: RemoteAuthentication;
  environmentName: string;
  expectedVersion?: string;
};

export type RemoteArtifactPolicy = {
  trace: "off" | "retain-on-failure";
  screenshot: "off" | "only-on-failure";
  video: "off" | "retain-on-failure";
};

const defaultArtifactPolicy: RemoteArtifactPolicy = {
  trace: "retain-on-failure",
  screenshot: "only-on-failure",
  video: "retain-on-failure",
};

const disabledArtifactPolicy: RemoteArtifactPolicy = {
  trace: "off",
  screenshot: "off",
  video: "off",
};

export function remoteTarget(environment: NodeJS.ProcessEnv = process.env): RemoteTarget | null {
  const rawUrl = environment.NAC_E2E_REMOTE_URL?.trim();
  if (!rawUrl) return null;

  const url = parseRemoteUrl(rawUrl);
  const authentication = parseAuthentication(environment, url.origin);
  const expectedVersion = environment.NAC_E2E_REMOTE_EXPECTED_VERSION?.trim() || undefined;
  const environmentName = environment.NAC_E2E_REMOTE_ENVIRONMENT?.trim() || "remote";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(environmentName)) {
    throw new Error("NAC_E2E_REMOTE_ENVIRONMENT must be a short non-secret label");
  }

  return {
    baseUrl: url.origin,
    authentication,
    environmentName,
    expectedVersion,
  };
}

export function requireRemoteTarget(environment: NodeJS.ProcessEnv = process.env): RemoteTarget {
  const target = remoteTarget(environment);
  if (target) return target;
  throw new Error("NAC_E2E_REMOTE_URL is required for remote E2E");
}

export function remoteArtifactPolicy(
  environment: NodeJS.ProcessEnv = process.env,
): RemoteArtifactPolicy {
  return portalLaunchRemoteMode(environment) ? disabledArtifactPolicy : defaultArtifactPolicy;
}

export function assertPortalDebuggingDisabled(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NAC_E2E_REMOTE_AUTH_MODE?.trim() !== "portal-launch") return;
  if (environment.DEBUG?.trim() || environment.PWDEBUG?.trim()) {
    throw new Error("portal-launch remote E2E requires DEBUG and PWDEBUG to be unset");
  }
}

function portalLaunchRemoteMode(environment: NodeJS.ProcessEnv): boolean {
  return (
    environment.NAC_E2E_REMOTE === "1" &&
    environment.NAC_E2E_REMOTE_AUTH_MODE?.trim() === "portal-launch"
  );
}

function parseAuthentication(
  environment: NodeJS.ProcessEnv,
  expectedOrigin: string,
): RemoteAuthentication {
  const mode = environment.NAC_E2E_REMOTE_AUTH_MODE?.trim() || "basic";
  if (mode === "basic") {
    rejectPresent(environment, "NAC_E2E_REMOTE_LAUNCH_URL", "basic");
    return {
      mode,
      username: requiredTrimmed(environment, "NAC_E2E_REMOTE_USERNAME"),
      password: requiredTrimmed(environment, "NAC_E2E_REMOTE_PASSWORD"),
    };
  }
  if (mode === "portal-launch") {
    assertPortalDebuggingDisabled(environment);
    rejectPresent(environment, "NAC_E2E_REMOTE_USERNAME", mode);
    rejectPresent(environment, "NAC_E2E_REMOTE_PASSWORD", mode);
    return {
      mode,
      launchUrl: parseLaunchUrl(required(environment, "NAC_E2E_REMOTE_LAUNCH_URL"), expectedOrigin),
    };
  }
  throw new Error("NAC_E2E_REMOTE_AUTH_MODE must be basic or portal-launch");
}

function parseRemoteUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NAC_E2E_REMOTE_URL must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("NAC_E2E_REMOTE_URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("NAC_E2E_REMOTE_URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new Error("NAC_E2E_REMOTE_URL must not contain a query or fragment");
  }
  if (url.pathname !== "/") {
    throw new Error("NAC_E2E_REMOTE_URL must identify the host root");
  }
  return url;
}

function parseLaunchUrl(value: string, expectedOrigin: string): string {
  if (value !== value.trim()) {
    throw new Error("NAC_E2E_REMOTE_LAUNCH_URL must not have surrounding whitespace");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("NAC_E2E_REMOTE_LAUNCH_URL must be an absolute HTTPS URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("NAC_E2E_REMOTE_LAUNCH_URL must use HTTPS");
  }
  if (url.username || url.password || url.hash) {
    throw new Error("NAC_E2E_REMOTE_LAUNCH_URL contains forbidden URL components");
  }
  if (url.origin !== expectedOrigin) {
    throw new Error("NAC_E2E_REMOTE_LAUNCH_URL must use the exact remote target origin");
  }
  const entries = [...url.searchParams.entries()];
  if (
    url.pathname !== "/__managed/launch" ||
    entries.length !== 1 ||
    entries[0]?.[0] !== "ticket" ||
    !/^[A-Za-z0-9_-]{43}$/.test(entries[0][1])
  ) {
    throw new Error("NAC_E2E_REMOTE_LAUNCH_URL does not match the managed launch route");
  }
  return url.toString();
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value?.trim()) return value;
  throw new Error(`${name} is required when NAC_E2E_REMOTE_URL is set`);
}

function requiredTrimmed(environment: NodeJS.ProcessEnv, name: string): string {
  return required(environment, name).trim();
}

function rejectPresent(environment: NodeJS.ProcessEnv, name: string, mode: string): void {
  if (environment[name]?.trim()) {
    throw new Error(`${name} is not allowed in ${mode} authentication mode`);
  }
}
