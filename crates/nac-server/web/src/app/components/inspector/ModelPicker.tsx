import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useCallback } from "react";

import { PopoverPlacement } from "@/app/atoms";
import { standardEffort } from "@/app/components/modals/options";
import { ModelPicker as ComposerModelChip } from "@/app/features/home/ComposerModelPickers";
import { useManagedModelProfile } from "@/app/features/managed/controller/useManagedModelProfile";
import {
  classifySetupFailure,
  setupFailureMessage,
  setupReconciliation,
} from "@/app/features/setup/browserAdapters";
import { useSetupAction } from "@/app/features/setup/useSetupAction";
import { SetupFailure, setupSequence } from "@/app/features/setup/workflow";
import { catalogBaseUrl, resolveCatalogModel, type CatalogPick } from "@/app/lib/catalog";
import {
  speedForCatalogRoute,
  speedLabel,
  supportsSpeed,
  type ServiceTier,
} from "@/app/lib/serviceTier";
import { useToast } from "@/app/providers/ToastProvider";
import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { useModelCatalog, useSessionConfig, useSessionSnapshot } from "@/app/services/queries";
import { queryKeys } from "@/app/services/queries/keys";
import type {
  BackendKind,
  ModelCatalog,
  ReasoningEffort,
  SessionMetadata,
  UpdateConfigRequest,
} from "@/app/types/api";

const READBACK_FAILED = new Error(
  "Settings were saved, but the latest session could not be loaded. Reload before editing again.",
);

function captureReadback(client: QueryClient, sessionId: string) {
  return [queryKeys.sessionConfig(sessionId), queryKeys.sessionSnapshot(sessionId)].flatMap(
    (key) => {
      const query = client.getQueryCache().find({ queryKey: key, exact: true });
      return query?.isActive()
        ? [{ key, updates: query.state.dataUpdateCount + query.state.errorUpdateCount }]
        : [];
    },
  );
}

function waitForModelReadback(
  client: QueryClient,
  checkpoint: ReturnType<typeof captureReadback>,
  signal: AbortSignal,
) {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (ready: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      unsubscribe();
      signal.removeEventListener("abort", abort);
      resolve(ready);
    };
    const abort = () => finish(false);
    const check = () => {
      if (signal.aborted) return abort();
      const observed = checkpoint.map(({ key, updates }) => ({
        state: client.getQueryState(key),
        updates,
      }));
      if (
        observed.some(
          ({ state, updates }) =>
            !state ||
            state.fetchStatus !== "idle" ||
            state.dataUpdateCount + state.errorUpdateCount <= updates,
        )
      )
        return;
      finish(!observed.some(({ state }) => state?.status === "error"));
    };
    // Stream reconciliation can cancel and immediately replace the awaited readback.
    const unsubscribe = client.getQueryCache().subscribe(() => queueMicrotask(check));
    const deadline = setTimeout(abort, 10_000);
    signal.addEventListener("abort", abort, { once: true });
    queueMicrotask(check);
  });
}

/**
 * The session's model, reasoning, and speed, directly switchable beside the
 * composer from one catalog spanning every connected provider. Cross-provider
 * changes send the complete routing tuple in one revisioned server mutation.
 */
export function ModelPicker({
  sessionId,
  metadata,
  label,
  disabled,
}: {
  sessionId: string;
  metadata: SessionMetadata | null;
  /** What the status bar shows while the snapshot carries no metadata yet. */
  label: string;
  /** A run is in flight, and the server refuses a config change until it ends. */
  disabled: boolean;
}) {
  const toast = useToast();
  const catalog = useModelCatalog();
  const managedModel = useManagedModelProfile();
  const client = useQueryClient();
  const config = useSessionConfig(metadata ? sessionId : null);
  const snapshot = useSessionSnapshot(sessionId, { enabled: false });
  const action = useSetupAction();
  const { api } = useNativeRuntime();
  const current = config.data ?? metadata;
  const currentBackend = current?.backend ?? metadata?.backend;
  const currentModel = current?.model ?? label;
  const currentEffort = current?.reasoning_effort ?? "";
  const currentSpeed = (current?.service_tier ?? null) as ServiceTier | null;
  const route = currentBackend
    ? { backend: currentBackend as BackendKind, model: currentModel, baseUrl: current?.base_url }
    : null;
  const speedCapability = speedForCatalogRoute(catalog.data, route);
  const resolved = resolveCatalogModel(catalog.data, currentBackend, currentModel);
  const canChange =
    !disabled &&
    metadata != null &&
    config.isSuccess &&
    !snapshot.isError &&
    !action.busy &&
    !action.needsReview;
  const { credentialReady: managedReady, matches: managedMatches } = managedModel;
  // A managed host's mounted model is usable before its account reads as connected.
  const usableProvider = useCallback(
    (provider: ModelCatalog["providers"][number]) =>
      provider.auth_status === "ready" ||
      (managedReady &&
        managedMatches({
          backend: provider.id,
          model: "",
          baseUrl: catalogBaseUrl(provider) ?? "",
        })),
    [managedReady, managedMatches],
  );

  const change = async (patch: UpdateConfigRequest, success: string) => {
    const version = config.data?.config_version;
    if (!canChange || version == null) return;
    try {
      const refreshed = await action.run((lease) =>
        setupSequence(
          {
            current: lease.current,
            classify: classifySetupFailure,
            reconcile: setupReconciliation(client, sessionId),
          },
          (step) =>
            Effect.gen(function* () {
              const checkpoint = yield* step("configuration", async () => {
                await api.updateConfig(sessionId, {
                  ...patch,
                  expected_config_version: version,
                });
                return captureReadback(client, sessionId);
              });
              const ready = yield* Effect.promise(() =>
                waitForModelReadback(client, checkpoint, lease.signal),
              );
              if (!ready) {
                return yield* Effect.fail(
                  new SetupFailure({
                    phase: "configuration",
                    kind: "rejected",
                    cause: READBACK_FAILED,
                    completed: ["configuration"],
                  }),
                );
              }
              return true;
            }),
        ),
      );
      if (refreshed) toast.success(success);
    } catch (error) {
      toast.error(
        error instanceof SetupFailure && error.cause === READBACK_FAILED
          ? READBACK_FAILED.message
          : setupFailureMessage(error),
      );
    }
  };

  const chooseModel = (pick: CatalogPick, clearIncompatibleSpeed: boolean) => {
    if (!canChange || (pick.backend === currentBackend && pick.model === currentModel)) return;
    const provider = catalog.data?.providers.find((entry) => entry.id === pick.backend);
    const preservesRoute = pick.backend === currentBackend;
    const providerReady = Boolean(
      provider?.auth_status === "ready" ||
      (managedModel.matches(pick) && managedModel.credentialReady),
    );
    if (!preservesRoute && !providerReady) {
      toast.error(`Connect ${pick.backend} in Settings › Accounts & keys to switch to this model.`);
      return;
    }
    if (!preservesRoute && !pick.baseUrl) {
      toast.error(`The catalog did not provide an endpoint for ${pick.backend}.`);
      return;
    }

    const supported = resolveCatalogModel(catalog.data, pick.backend, pick.model).supportedEfforts;
    const compatibleEffort =
      currentEffort && supported.includes(currentEffort as ReasoningEffort)
        ? currentEffort
        : standardEffort(supported);
    const targetSpeed = speedForCatalogRoute(catalog.data, {
      ...pick,
      baseUrl: preservesRoute ? current?.base_url : pick.baseUrl,
    });
    const incompatible = currentSpeed != null && !targetSpeed.explicitTiersAllowed;
    if (incompatible && !clearIncompatibleSpeed)
      return {
        error: "This model does not accept the selected speed.",
        confirmSpeedClear: true,
      };
    const speed = incompatible
      ? null
      : currentSpeed && !supportsSpeed(targetSpeed.tiers, currentSpeed)
        ? "standard"
        : currentSpeed;
    const speedPatch = speed !== currentSpeed ? { service_tier: speed } : {};
    const patch = preservesRoute
      ? { model: pick.model, reasoning_effort: compatibleEffort, ...speedPatch }
      : {
          backend: pick.backend,
          model: pick.model,
          base_url: pick.baseUrl,
          // Account credentials remain server-owned. A null selector asks the
          // selected backend to resolve its managed login or conventional env.
          api_key_env: provider?.connection?.api_key_env ?? null,
          reasoning_effort: compatibleEffort,
          ...speedPatch,
          // Provider-specific headers must never leak into another backend.
          extra_headers: null,
        };
    const notice = incompatible
      ? ". Speed preference cleared."
      : speed !== currentSpeed
        ? ". Speed changed to Standard."
        : "";
    void change(patch, `Model switched to ${pick.model}${notice}`);
  };

  const chooseEffort = (effort: string) => {
    if (effort === currentEffort) return;
    void change({ reasoning_effort: effort }, `Reasoning set to ${effort}`);
  };

  const chooseSpeed = (speed: ServiceTier | null) => {
    if (speed === currentSpeed) return;
    void change({ service_tier: speed }, `Speed set to ${speedLabel(speed)}`);
  };

  return (
    <ComposerModelChip
      key={action.needsReview || config.isError || snapshot.isError ? "reload-needed" : "current"}
      fallbackLabel={currentModel}
      pending={!metadata}
      value={route}
      effort={currentEffort}
      supportedEfforts={resolved.supportedEfforts}
      speed={{ ...speedCapability, value: currentSpeed, onChange: chooseSpeed }}
      disabled={!canChange}
      placement={PopoverPlacement.TopRight}
      usableProvider={usableProvider}
      onPick={chooseModel}
      onEffort={chooseEffort}
    />
  );
}
