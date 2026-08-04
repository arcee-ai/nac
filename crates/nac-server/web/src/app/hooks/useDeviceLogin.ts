import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { errorMessage } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { DeviceLoginStarted, ManagedAuthProvider } from "@/app/types/api";

/**
 * How often the outcome is collected. The provider is polled by the server at
 * whatever interval it asked for; this only decides how quickly the page
 * notices that the wait is over.
 */
const POLL_MS = 2000;

export type DeviceLoginState =
  | { status: "idle" }
  | { status: "starting" }
  /** The code has been issued and the browser tab is open. */
  | { status: "waiting"; prompt: DeviceLoginStarted }
  | { status: "failed"; message: string };

/**
 * Drives a device login from the page: asks the server to start one, sends the
 * user to the provider, and waits for the approval to come back.
 *
 * Leaving the page does not abandon the login — the server keeps waiting, and
 * a login started here can still be collected after a reload. Only `cancel`
 * gives up on it.
 */
export function useDeviceLogin(onSuccess?: () => void) {
  const client = useQueryClient();
  const [state, setState] = useState<DeviceLoginState>({ status: "idle" });
  const active = useRef<{
    provider: ManagedAuthProvider;
    loginId: string;
  } | null>(null);

  // Kept in a ref so a caller that rebuilds the callback each render does not
  // restart the polling loop.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const start = useCallback(async (provider: ManagedAuthProvider) => {
    setState({ status: "starting" });
    try {
      const started = await api.startManagedLogin(provider);
      active.current = { provider, loginId: started.login_id };
      setState({ status: "waiting", prompt: started });
      // Opened straight from the click so the popup blocker treats it as the
      // user's own navigation.
      window.open(started.verification_uri, "_blank", "noopener,noreferrer");
    } catch (error) {
      active.current = null;
      setState({ status: "failed", message: errorMessage(error) });
    }
  }, []);

  const cancel = useCallback(async () => {
    const pending = active.current;
    active.current = null;
    setState({ status: "idle" });
    if (!pending) return;
    try {
      await api.cancelManagedLogin(pending.provider, pending.loginId);
    } catch {
      // Nothing was stored, and the server drops the login once its code
      // expires, so a failed cancel costs nothing.
    }
  }, []);

  useEffect(() => {
    if (state.status !== "waiting") return;
    const { provider, login_id: loginId } = state.prompt;
    const controller = new AbortController();
    let stopped = false;
    let timer = 0;

    const poll = async () => {
      try {
        const outcome = await api.pollManagedLogin(
          provider,
          loginId,
          controller.signal,
        );
        if (stopped) return;
        if (outcome.state === "complete") {
          active.current = null;
          setState({ status: "idle" });
          void client.invalidateQueries({ queryKey: queryKeys.managedAuth });
          // The model index is only readable once signed in, so the picker
          // stays empty until this refetch lands.
          void client.invalidateQueries({
            queryKey: queryKeys.managedProviderModelsAll,
          });
          onSuccessRef.current?.();
          return;
        }
        if (outcome.state === "failed") {
          active.current = null;
          setState({ status: "failed", message: outcome.error });
          return;
        }
        timer = window.setTimeout(() => void poll(), POLL_MS);
      } catch (error) {
        if (stopped) return;
        active.current = null;
        setState({ status: "failed", message: errorMessage(error) });
      }
    };

    timer = window.setTimeout(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [state, client]);

  return { state, start, cancel };
}
