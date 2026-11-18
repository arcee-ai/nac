import { useEffect, useMemo, useRef, useState } from "react";

import { ButtonSize, PopoverPlacement, Tooltip, TooltipPosition } from "@/app/atoms";
import { CatalogModelPicker } from "@/app/components/modals/CatalogModelPicker";
import {
  EFFORT_LEVEL_OPTIONS,
  reasoningOptionsFor,
  standardEffort,
} from "@/app/components/modals/options";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { useManagedModelProfile } from "@/app/features/managed/controller/useManagedModelProfile";
import { resolveCatalogModel, type CatalogPick } from "@/app/lib/catalog";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { useToast } from "@/app/providers/ToastProvider";
import { useModelCatalog, useReadyProviderModels, useUpdateConfig } from "@/app/services/queries";
import type { BackendKind, ReasoningEffort, SessionMetadata } from "@/app/types/api";

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
  const liveByBackend = useReadyProviderModels(catalog.data);
  const updateConfig = useUpdateConfig();
  const currentModel = metadata?.model ?? label;
  const currentEffort = metadata?.reasoning_effort ?? "";
  const currentPick: CatalogPick | null = metadata
    ? {
        backend: metadata.backend as BackendKind,
        model: metadata.model,
        baseUrl: metadata.base_url ?? "",
      }
    : null;
  const resolved = resolveCatalogModel(catalog.data, metadata?.backend, currentModel);
  const defaultEffort = standardEffort(resolved.supportedEfforts);
  // Shown while a session without a level is being given its standard one.
  const shownEffort = currentEffort || defaultEffort || "";
  const effortItems = useMemo(
    () => reasoningOptionsFor(resolved.supportedEfforts, shownEffort, EFFORT_LEVEL_OPTIONS),
    [resolved.supportedEfforts, shownEffort],
  );
  const noEfforts = Boolean(catalog.data) && resolved.supportedEfforts.length === 0;
  const selectedEffort = effortItems.find((item) => item.id === shownEffort)?.label;
  const effortLabel = noEfforts
    ? "not available"
    : typeof selectedEffort === "string"
      ? selectedEffort
      : "not set";
  const [effortOpen, setEffortOpen] = useState(false);

  // A session with no level, on a model that accepts levels, runs at the
  // standard one. Applied once per session, and only while it is idle.
  // TODO(backend): the server should store this level when the session is created.
  const { mutate: applyConfig, isPending: configPending } = updateConfig;
  const defaulted = useRef<string | null>(null);
  useEffect(() => {
    if (!metadata || !catalog.data || currentEffort || !defaultEffort) return;
    if (disabled || configPending) return;
    if (defaulted.current === sessionId) return;
    defaulted.current = sessionId;
    applyConfig({ id: sessionId, patch: { reasoning_effort: defaultEffort } });
  }, [
    metadata,
    catalog.data,
    currentEffort,
    defaultEffort,
    disabled,
    configPending,
    sessionId,
    applyConfig,
  ]);

  const chooseModel = async (pick: CatalogPick) => {
    if (!metadata || (pick.backend === metadata.backend && pick.model === metadata.model)) return;
    const provider = catalog.data?.providers.find((entry) => entry.id === pick.backend);
    const preservesRoute = pick.backend === metadata.backend;
    const providerReady = Boolean(
      provider?.auth_status === "ready" ||
      (managedModel.matches(pick) && managedModel.credentialReady),
    );
    if (!preservesRoute && !providerReady) {
      toast.error(`Connect ${pick.backend} in session settings before switching to this model.`);
      return;
    }
    if (!preservesRoute && !pick.baseUrl) {
      toast.error(`Configure an endpoint for ${pick.backend} in session settings first.`);
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
    <div className="flex min-w-0 items-center">
      <CatalogModelPicker
        catalog={catalog.data}
        loading={catalog.isLoading}
        failed={catalog.isError}
        compact
        disabled={disabled || !metadata || updateConfig.isPending}
        liveByBackend={liveByBackend}
        value={currentPick}
        onSelect={(pick) => void chooseModel(pick)}
      />
      <Tooltip
        title={`Effort: ${effortLabel}`}
        description={
          noEfforts
            ? "This model has no reasoning levels to choose from."
            : "How much the model reasons before it answers."
        }
        position={TooltipPosition.TopCenter}
        sticky
        disabled={effortOpen}
      >
        <SmallSelect
          items={noEfforts ? [] : effortItems}
          value={noEfforts ? "" : shownEffort}
          placeholder={noEfforts ? "Not available" : "Effort"}
          disabled={noEfforts || disabled || !metadata || updateConfig.isPending}
          size={ButtonSize.Small}
          trailingIcon={null}
          triggerClassName="!pl-1 [--color-text-btn-secondary:var(--color-text-basic-tertiary)]"
          placement={PopoverPlacement.TopCenter}
          onOpenChange={setEffortOpen}
          onValueChange={(effort) => void chooseEffort(effort)}
        />
      </Tooltip>
    </div>
  );
}
