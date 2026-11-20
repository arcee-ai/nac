import { useQueryClient } from "@tanstack/react-query";
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
import { setupSequence } from "@/app/features/setup/workflow";
import { catalogBaseUrl, resolveCatalogModel, type CatalogPick } from "@/app/lib/catalog";
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

/**
 * The session's current model and reasoning, directly switchable beside the
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
      const confirmed = await action.run((lease) =>
        setupSequence(
          {
            current: lease.current,
            classify: classifySetupFailure,
            reconcile: setupReconciliation(client, sessionId),
          },
          (step) =>
            Effect.gen(function* () {
              yield* step("configuration", () =>
                api.updateConfig(sessionId, {
                  ...patch,
                  expected_config_version: version,
                }),
              );
              return true;
            }),
        ),
      );
      if (!confirmed) return;
      if (
        [queryKeys.sessionConfig(sessionId), queryKeys.sessionSnapshot(sessionId)].some(
          (key) => client.getQueryState(key)?.status === "error",
        )
      ) {
        toast.error(
          "Settings were saved, but the latest session could not be loaded. Reload before editing again.",
        );
      } else {
        toast.success(success);
      }
    } catch (error) {
      toast.error(setupFailureMessage(error));
    }
  };

  const chooseModel = (pick: CatalogPick) => {
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
    const patch = preservesRoute
      ? { model: pick.model, reasoning_effort: compatibleEffort }
      : {
          backend: pick.backend,
          model: pick.model,
          base_url: pick.baseUrl,
          // Account credentials remain server-owned. A null selector asks the
          // selected backend to resolve its managed login or conventional env.
          api_key_env: provider?.connection?.api_key_env ?? null,
          reasoning_effort: compatibleEffort,
          // Provider-specific headers must never leak into another backend.
          extra_headers: null,
        };
    void change(patch, `Model switched to ${pick.model}`);
  };

  const chooseEffort = (effort: string) => {
    if (effort === currentEffort) return;
    void change({ reasoning_effort: effort }, `Reasoning set to ${effort}`);
  };

  return (
    <ComposerModelChip
      fallbackLabel={currentModel}
      pending={!metadata}
      value={
        currentBackend ? { backend: currentBackend as BackendKind, model: currentModel } : null
      }
      effort={currentEffort}
      supportedEfforts={resolved.supportedEfforts}
      disabled={!canChange}
      placement={PopoverPlacement.TopRight}
      usableProvider={usableProvider}
      onPick={chooseModel}
      onEffort={chooseEffort}
    />
  );
}
