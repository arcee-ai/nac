export type RemoteTarget = {
  baseUrl: string;
  username: string;
  password: string;
  expectedVersion?: string;
};

export function remoteTarget(environment: NodeJS.ProcessEnv = process.env): RemoteTarget | null {
  const rawUrl = environment.NAC_E2E_REMOTE_URL?.trim();
  if (!rawUrl) return null;

  const url = parseRemoteUrl(rawUrl);
  const username = required(environment, "NAC_E2E_REMOTE_USERNAME");
  const password = required(environment, "NAC_E2E_REMOTE_PASSWORD");
  const expectedVersion = environment.NAC_E2E_REMOTE_EXPECTED_VERSION?.trim() || undefined;

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    username,
    password,
    expectedVersion,
  };
}

export function requireRemoteTarget(environment: NodeJS.ProcessEnv = process.env): RemoteTarget {
  const target = remoteTarget(environment);
  if (target) return target;
  throw new Error("NAC_E2E_REMOTE_URL is required for remote E2E");
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

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value) return value;
  throw new Error(`${name} is required when NAC_E2E_REMOTE_URL is set`);
}
