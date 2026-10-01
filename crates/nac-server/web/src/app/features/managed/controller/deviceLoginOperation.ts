import { QueryObserver, type QueryClient } from "@tanstack/react-query";

import { errorMessage } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { refreshProviderAuthentication } from "@/app/services/queries/configuration";
import type { DeviceLoginStarted, ManagedAuthProvider } from "@/app/types/api";
import { toRunError } from "@/app/lib/providerError";
import { authenticationCommand, runAuthentication } from "./authenticationWorkflow";

export type DeviceLoginState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "waiting"; prompt: DeviceLoginStarted }
  | { status: "failed"; message: string };

interface Attempt {
  provider: ManagedAuthProvider;
  prompt?: DeviceLoginStarted;
  cancelled: boolean;
  dispose?: () => void;
}

export interface DeviceLoginOperation {
  attempt: Attempt;
  state: DeviceLoginState;
  completed: boolean;
}

export const deviceLoginKey = (provider: ManagedAuthProvider | null) =>
  ["provider-device-login-attempt", provider] as const;

/** One provider attempt per origin QueryClient; no persisted browser credential. */
export async function startDeviceLogin(client: QueryClient, provider: ManagedAuthProvider) {
  const key = deviceLoginKey(provider);
  const existing = client.getQueryData<DeviceLoginOperation>(key);
  if (existing && ["starting", "waiting"].includes(existing.state.status))
    return { attempt: existing.attempt, fresh: false };

  const attempt: Attempt = { provider, cancelled: false };
  const current = () => client.getQueryData<DeviceLoginOperation>(key)?.attempt === attempt;
  const publish = (state: DeviceLoginState, completed = false) => {
    if (current()) client.setQueryData<DeviceLoginOperation>(key, { attempt, state, completed });
  };
  client.setQueryDefaults(key, { gcTime: Infinity });
  client.setQueryData<DeviceLoginOperation>(key, {
    attempt,
    state: { status: "starting" },
    completed: false,
  });
  try {
    const prompt = await runAuthentication(
      authenticationCommand({
        command: () => api.startManagedLogin(provider),
      }),
    );
    attempt.prompt = prompt;
    if (attempt.cancelled) {
      await api.cancelManagedLogin(provider, prompt.login_id).catch(() => {});
      return { attempt, fresh: false };
    }
    if (!current()) return { attempt, fresh: false };
    publish({ status: "waiting", prompt });

    // TanStack owns polling, deduplication and the AbortSignal. The observation
    // belongs to this accepted provider operation, not its collapsible view.
    const pollKey = ["provider-device-login", provider, prompt.login_id] as const;
    const observer = new QueryObserver(client, {
      queryKey: pollKey,
      queryFn: async ({ signal }) => {
        const result = await api.pollManagedLogin(provider, prompt.login_id, signal);
        if (result.state === "complete" && current()) await refreshProviderAuthentication(client);
        return result;
      },
      retry: false,
      refetchInterval: (query) =>
        !query.state.error && (!query.state.data || query.state.data.state === "pending")
          ? 2000
          : false,
      refetchIntervalInBackground: true,
      gcTime: 0,
    });
    let stopped = false;
    let unsubscribeCache = () => {};
    const dispose = () => {
      if (stopped) return;
      stopped = true;
      attempt.dispose = undefined;
      observer.destroy();
      unsubscribeCache();
      client.removeQueries({ queryKey: pollKey, exact: true });
    };
    attempt.dispose = dispose;
    unsubscribeCache = client.getQueryCache().subscribe((event) => {
      if (
        event.type === "removed" &&
        event.query.queryKey[0] === key[0] &&
        event.query.queryKey[1] === provider &&
        event.query.state.data?.attempt === attempt
      )
        dispose();
    });
    observer.subscribe((result) => {
      if (stopped || attempt.cancelled || !current()) return;
      if (result.isError) {
        publish({ status: "failed", message: errorMessage(toRunError(result.error)) });
        dispose();
      } else if (result.data?.state === "complete") {
        publish({ status: "idle" }, true);
        dispose();
      } else if (result.data?.state === "failed") {
        publish({ status: "failed", message: result.data.error });
        dispose();
      }
    });
    return { attempt, fresh: true };
  } catch (error) {
    publish({ status: "failed", message: errorMessage(toRunError(error)) });
    return { attempt, fresh: false };
  }
}

/** Explicit Cancel, including start races, alone abandons the durable login. */
export async function cancelDeviceLogin(client: QueryClient, provider: ManagedAuthProvider) {
  const key = deviceLoginKey(provider);
  const operation = client.getQueryData<DeviceLoginOperation>(key);
  if (!operation || !["starting", "waiting"].includes(operation.state.status)) return;
  const attempt = operation.attempt;
  attempt.cancelled = true;
  attempt.dispose?.();
  client.setQueryData<DeviceLoginOperation>(key, {
    attempt,
    state: { status: "idle" },
    completed: false,
  });
  if (attempt.prompt)
    await api.cancelManagedLogin(provider, attempt.prompt.login_id).catch(() => {});
}
