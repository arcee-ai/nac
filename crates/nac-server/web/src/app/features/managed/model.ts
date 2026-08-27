import type { ManagedCloneOperation } from "@/app/types/api";

export type ManagedTab = "status" | "github" | "secrets";

export const MANAGED_TABS: readonly ManagedTab[] = ["status", "github", "secrets"];

const RESERVED_SECRET_NAMES = new Set([
  "PATH",
  "HOME",
  "NAC_HOME",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "EXA_API_KEY",
]);

export function managedSecretNameError(name: string): string {
  if (!name) return "Enter a variable name.";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return "Use letters, digits, and underscores; the first character cannot be a digit.";
  }
  if (RESERVED_SECRET_NAMES.has(name)) {
    return `${name} is managed by NAC and cannot be replaced here.`;
  }
  return "";
}

export function repositoryIdentity(fullName: string | null | undefined): [string, string] | null {
  const parts = fullName?.split("/") ?? [];
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
}

export function cloneIsRunning(operation: ManagedCloneOperation | null): boolean {
  return operation?.status === "running";
}
