import { useCallback } from "react";

import { PopoverPlacement } from "@/app/atoms";
import { standardEffort } from "@/app/components/modals/options";
import { ModelPicker as ComposerModelChip } from "@/app/features/home/ComposerModelPickers";
import { useManagedModelProfile } from "@/app/features/managed/controller/useManagedModelProfile";
import { catalogBaseUrl, resolveCatalogModel, type CatalogPick } from "@/app/lib/catalog";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { useToast } from "@/app/providers/ToastProvider";
import { useModelCatalog, useUpdateConfig } from "@/app/services/queries";
import type { BackendKind, ModelCatalog, ReasoningEffort, SessionMetadata } from "@/app/types/api";

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
  const updateConfig = useUpdateConfig();
  const currentModel = metadata?.model ?? label;
  const currentEffort = metadata?.reasoning_effort ?? "";
  const resolved = resolveCatalogModel(catalog.data, metadata?.backend, currentModel);
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

  const chooseModel = async (pick: CatalogPick) => {
    if (!metadata || (pick.backend === metadata.backend && pick.model === metadata.model)) return;
    const provider = catalog.data?.providers.find((entry) => entry.id === pick.backend);
    const preservesRoute = pick.backend === metadata.backend;
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
    try {
      await updateConfig.mutateAsync({ id: sessionId, patch });
      toast.success(`Model switched to ${pick.model}`);
    } catch (error) {
      toast.error(`The model was not switched: ${humanErrorText(toRunError(error), pick.backend)}`);
    }
  };

  const chooseEffort = async (effort: string) => {
    if (!metadata || effort === currentEffort) return;
    try {
      await updateConfig.mutateAsync({
        id: sessionId,
        patch: { reasoning_effort: effort },
      });
      toast.success(`Reasoning set to ${effort}`);
    } catch (error) {
      toast.error(
        `Reasoning was not changed: ${humanErrorText(toRunError(error), metadata.backend)}`,
      );
    }
  };

  return (
    <ComposerModelChip
      fallbackLabel={currentModel}
      pending={!metadata}
      value={metadata ? { backend: metadata.backend as BackendKind, model: metadata.model } : null}
      effort={currentEffort}
      supportedEfforts={resolved.supportedEfforts}
      disabled={disabled || !metadata || updateConfig.isPending}
      placement={PopoverPlacement.TopRight}
      usableProvider={usableProvider}
      onPick={(pick) => void chooseModel(pick)}
      onEffort={(effort) => void chooseEffort(effort)}
    />
  );
}
