import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useSetupLifetime } from "@/app/features/setup/lifetime";
import type { ManagedAuthProvider } from "@/app/types/api";
import {
  cancelDeviceLogin,
  deviceLoginKey,
  startDeviceLogin,
  type DeviceLoginOperation,
  type DeviceLoginState,
} from "./deviceLoginOperation";

export type { DeviceLoginState } from "./deviceLoginOperation";

/** Local presentation detaches; accepted authentication settles its origin. */
export function useDeviceLogin(onSuccess?: () => void, provider?: ManagedAuthProvider | null) {
  const client = useQueryClient();
  const lifetime = useSetupLifetime();
  const [selected, setSelected] = useState<ManagedAuthProvider | null>(provider ?? null);
  const [started, setStarted] = useState<{
    attempt: DeviceLoginOperation["attempt"];
    current: () => boolean;
  } | null>(null);
  const observedProvider = provider ?? selected;
  const visibleProvider = useRef(observedProvider);
  useLayoutEffect(() => {
    visibleProvider.current = observedProvider;
  }, [observedProvider]);
  const key = deviceLoginKey(observedProvider);
  const operation = useQuery<DeviceLoginOperation | null>({
    queryKey: key,
    queryFn: () => client.getQueryData<DeviceLoginOperation>(key) ?? null,
    enabled: false,
    gcTime: Infinity,
  }).data;
  const onSuccessRef = useRef(onSuccess);
  const delivered = useRef<DeviceLoginOperation["attempt"] | null>(null);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const start = useCallback(
    async (nextProvider: ManagedAuthProvider) => {
      const lease = lifetime.current;
      if (!lease?.current()) return;
      visibleProvider.current = nextProvider;
      setSelected(nextProvider);
      const result = await startDeviceLogin(client, nextProvider);
      if (
        !lease.current() ||
        visibleProvider.current !== nextProvider ||
        client.getQueryData<DeviceLoginOperation>(deviceLoginKey(nextProvider))?.attempt !==
          result.attempt
      )
        return;
      setStarted({ attempt: result.attempt, current: lease.current });
      if (result.fresh && result.attempt.prompt && !result.attempt.cancelled)
        window.open(result.attempt.prompt.verification_uri, "_blank", "noopener,noreferrer");
    },
    [client, lifetime],
  );

  const cancel = useCallback(async () => {
    if (observedProvider) await cancelDeviceLogin(client, observedProvider);
  }, [client, observedProvider]);

  useEffect(() => {
    if (
      !operation?.completed ||
      operation.attempt !== started?.attempt ||
      !started.current() ||
      delivered.current === operation.attempt
    )
      return;
    delivered.current = operation.attempt;
    onSuccessRef.current?.();
  }, [operation, started]);

  const state: DeviceLoginState = operation?.state ?? { status: "idle" };
  return { state, start, cancel };
}
