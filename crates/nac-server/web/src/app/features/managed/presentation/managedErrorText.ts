import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { ApiError } from "@/app/services/api";

export function githubErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) {
    return "GitHub access was denied for this host. Ask the host owner to check access to the GitHub App.";
  }
  return humanErrorText(toRunError(error));
}

export function managedHostErrorText(error: unknown): string {
  if (error !== null && typeof error === "object" && "status" in error && error.status === 403) {
    return "Access to this managed host was denied. Ask the host owner to check access.";
  }
  return humanErrorText(toRunError(error));
}
