import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { errorMessage } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { refreshProviderAuthentication } from "@/app/services/queries/configuration";
import { useSetupLifetime } from "@/app/features/setup/lifetime";
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
  current: () => boolean;
}

/** Detach aborts observation only. Explicit Cancel alone abandons the server login. */
export function useDeviceLogin(onSuccess?: () => void) {
  const client = useQueryClient();
  const lifetime = useSetupLifetime();
  const [state, setState] = useState<DeviceLoginState>({ status: "idle" });
  const active = useRef<Attempt | null>(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const start = useCallback(
    async (provider: ManagedAuthProvider) => {
      const lease = lifetime.current;
      if (!lease?.current() || active.current) return;
      const attempt: Attempt = { provider, cancelled: false, current: lease.current };
      active.current = attempt;
      setState({ status: "starting" });
      try {
        const prompt = await runAuthentication(
          authenticationCommand({
            command: () => api.startManagedLogin(provider),
          }),
        );
        attempt.prompt = prompt;
        if (attempt.cancelled) {
          await api.cancelManagedLogin(provider, prompt.login_id).catch(() => {});
          return;
        }
        if (!attempt.current() || active.current !== attempt) return;
        setState({ status: "waiting", prompt });
        window.open(prompt.verification_uri, "_blank", "noopener,noreferrer");
      } catch (error) {
        if (!attempt.current() || active.current !== attempt) return;
        active.current = null;
        setState({ status: "failed", message: errorMessage(toRunError(error)) });
      }
    },
    [lifetime],
  );

  const cancel = useCallback(async () => {
    const attempt = active.current;
    if (!attempt) return;
    attempt.cancelled = true;
    active.current = null;
    if (attempt.current()) setState({ status: "idle" });
    if (attempt.prompt)
      await api.cancelManagedLogin(attempt.provider, attempt.prompt.login_id).catch(() => {});
  }, []);

  const prompt = state.status === "waiting" ? state.prompt : null;
  const outcome = useQuery({
    queryKey: ["provider-device-login", prompt?.provider, prompt?.login_id],
    enabled: prompt !== null,
    queryFn: async ({ signal }) => {
      if (!prompt) throw new Error("No provider login to observe");
      const result = await api.pollManagedLogin(prompt.provider, prompt.login_id, signal);
      // Reconcile the originating cache before exposing completion, even if the view detaches.
      if (result.state === "complete") await refreshProviderAuthentication(client);
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

  useEffect(() => {
    const attempt = active.current;
    if (
      !prompt ||
      !attempt?.current() ||
      attempt.prompt !== prompt ||
      (!outcome.error && outcome.data?.state === "pending") ||
      (!outcome.error && !outcome.data)
    )
      return;
    active.current = null;
    if (outcome.data?.state === "complete") onSuccessRef.current?.();
  }, [outcome.data, outcome.error, prompt]);

  const visibleState: DeviceLoginState =
    prompt && outcome.error
      ? { status: "failed", message: errorMessage(toRunError(outcome.error)) }
      : prompt && outcome.data?.state === "failed"
        ? { status: "failed", message: outcome.data.error }
        : prompt && outcome.data?.state === "complete"
          ? { status: "idle" }
          : state;

  return { state: visibleState, start, cancel };
}
