import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  PopoverPlacement,
  Tooltip,
  TooltipPosition,
  type SelectItem,
} from "@/app/atoms";
import { CatalogModelPicker } from "@/app/components/modals/CatalogModelPicker";
import { EFFORT_LEVEL_OPTIONS, reasoningOptionsFor } from "@/app/components/modals/options";
import { SpeedControl } from "@/app/components/modals/SpeedControl";
import {
  providerSpeedProfiles,
  speedForRoute,
  speedLabel,
  supportsSpeed,
  type ServiceTier,
} from "@/app/lib/serviceTier";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { useManagedModelProfile } from "@/app/features/managed/controller/useManagedModelProfile";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { resolveCatalogModel, type CatalogPick } from "@/app/lib/catalog";
import { cn } from "@/app/lib/cn";
import { humanErrorText, toRunError } from "@/app/lib/providerError";
import { useToast } from "@/app/providers/ToastProvider";
import {
  queryKeys,
  useModelCatalog,
  useReadyProviderModels,
  useSessionSnapshot,
  useUpdateConfig,
} from "@/app/services/queries";
import type { BackendKind, ReasoningEffort, SessionMetadata } from "@/app/types/api";

const EFFORT_ROW_HINTS: Record<string, { title: string; description: string }> = {
  "": {
    title: "Default effort",
    description:
      "NAC does not send an effort. The model answers the way it does when the level is left unset.",
  },
  none: {
    title: "None",
    description:
      "The model answers without a reasoning pass. This is the fastest and cheapest option.",
  },
  minimal: {
    title: "Minimal",
    description:
      "A very short reasoning pass before the answer. Slightly more careful than none, still built for speed.",
  },
  low: {
    title: "Low",
    description:
      "A light reasoning pass. Enough for small decisions, without a long investigation.",
  },
  medium: {
    title: "Medium",
    description: "A balanced reasoning pass. The model thinks the task through, then answers.",
  },
  high: {
    title: "High",
    description:
      "A deep reasoning pass. The model spends more time checking its work, so replies are slower and cost more.",
  },
  xhigh: {
    title: "X-High",
    description: "Extra-deep reasoning for hard problems. Longer and more expensive than high.",
  },
  max: {
    title: "Max",
    description:
      "The deepest reasoning this model offers. Slowest and most expensive, for the hardest tasks.",
  },
};

const COMPOSER_EFFORT_OPTIONS: SelectItem[] = [
  {
    id: "",
    label: "Default",
    hoverHint: { ...EFFORT_ROW_HINTS[""], muted: true },
  },
  ...EFFORT_LEVEL_OPTIONS.map((item) => ({
    ...item,
    hoverHint: { ...EFFORT_ROW_HINTS[item.id], muted: true },
  })),
];

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
  const isMobile = useIsMobile();
  const toast = useToast();
  const catalog = useModelCatalog();
  const managedModel = useManagedModelProfile();
  const liveByBackend = useReadyProviderModels(catalog.data);
  const queryClient = useQueryClient();
  const updateConfig = useUpdateConfig();
  // Observe the existing snapshot without starting a separate fetch. A failed
  // refresh leaves cached metadata visible, but it is unsafe for another edit.
  const snapshot = useSessionSnapshot(sessionId, { enabled: false });
  const controlsDisabled = disabled || !metadata || updateConfig.isPending || snapshot.isError;
  const reportRefreshFailure = () => {
    // Read the query after the mutation's awaited invalidation has settled.
    // React state can still be from the preceding render at this point.
    const state = queryClient.getQueryState(queryKeys.sessionSnapshot(sessionId));
    if (state?.status === "error")
      toast.error(
        "Settings were saved, but the latest session could not be loaded. Retry the refresh before making another change.",
      );
  };
  const currentModel = metadata?.model ?? label;
  const currentEffort = metadata?.reasoning_effort ?? "";
  const currentSpeed = (metadata?.service_tier ?? null) as ServiceTier | null;
  const currentPick: CatalogPick | null = metadata
    ? {
        backend: metadata.backend as BackendKind,
        model: metadata.model,
        baseUrl: metadata.base_url ?? "",
      }
    : null;
  const resolved = resolveCatalogModel(catalog.data, metadata?.backend, currentModel);
  const speedCapability = speedForRoute(
    resolved.model,
    currentModel,
    metadata?.backend,
    metadata?.base_url,
    providerSpeedProfiles(catalog.data?.providers.find((entry) => entry.id === metadata?.backend)),
  );
  const effortItems = useMemo(
    () => reasoningOptionsFor(resolved.supportedEfforts, currentEffort, COMPOSER_EFFORT_OPTIONS),
    [resolved.supportedEfforts, currentEffort],
  );
  const selectedEffort = effortItems.find((item) => item.id === currentEffort)?.label;
  const effortLabel = typeof selectedEffort === "string" ? selectedEffort : "Default";
  const [effortOpen, setEffortOpen] = useState(false);

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
      currentEffort && supported.includes(currentEffort as ReasoningEffort) ? currentEffort : null;
    const target = speedForRoute(
      resolveCatalogModel(catalog.data, pick.backend, pick.model).model,
      pick.model,
      pick.backend,
      preservesRoute ? metadata.base_url : pick.baseUrl,
      providerSpeedProfiles(provider),
    );
    const targetSpeed = target.tiers;
    let speed = currentSpeed;
    if (speed && pick.backend !== "chatgpt-codex-responses" && !target.openAiApi) {
      toast.error("Choose a compatible speed before switching to this model.");
      return;
    }
    if (speed && !supportsSpeed(targetSpeed, speed)) {
      speed = "standard";
    }
    const patch = preservesRoute
      ? {
          model: pick.model,
          reasoning_effort: compatibleEffort,
          ...(speed !== currentSpeed ? { service_tier: speed } : {}),
        }
      : {
          backend: pick.backend,
          model: pick.model,
          base_url: pick.baseUrl,
          // Account credentials remain server-owned. A null selector asks the
          // selected backend to resolve its managed login or conventional env.
          api_key_env: provider?.connection?.api_key_env ?? null,
          reasoning_effort: compatibleEffort,
          ...(speed !== currentSpeed ? { service_tier: speed } : {}),
          // Provider-specific headers must never leak into another backend.
          extra_headers: null,
        };
    try {
      await updateConfig.mutateAsync({ id: sessionId, patch });
      reportRefreshFailure();
      toast.success(
        `Model switched to ${pick.model}${speed !== currentSpeed ? "; speed reset to Standard" : ""}`,
      );
    } catch (error) {
      toast.error(`The model was not switched: ${humanErrorText(toRunError(error), pick.backend)}`);
    }
  };

  const chooseEffort = async (effort: string) => {
    if (!metadata || effort === currentEffort) return;
    try {
      await updateConfig.mutateAsync({
        id: sessionId,
        patch: { reasoning_effort: effort || null },
      });
      reportRefreshFailure();
      toast.success(`Reasoning set to ${effort || "the model default"}`);
    } catch (error) {
      toast.error(
        `Reasoning was not changed: ${humanErrorText(toRunError(error), metadata.backend)}`,
      );
    }
  };

  const chooseSpeed = async (speed: ServiceTier | null) => {
    if (!metadata || speed === currentSpeed) return;
    try {
      await updateConfig.mutateAsync({ id: sessionId, patch: { service_tier: speed } });
      reportRefreshFailure();
      toast.success(`Speed set to ${speedLabel(speed)}`);
    } catch (error) {
      toast.error(`Speed was not changed: ${humanErrorText(toRunError(error), metadata.backend)}`);
    }
  };

  return (
    <div className={cn("flex min-w-0 items-center", isMobile ? "gap-1" : "gap-2")}>
      <CatalogModelPicker
        catalog={catalog.data}
        loading={catalog.isLoading}
        failed={catalog.isError}
        compact
        disabled={controlsDisabled}
        liveByBackend={liveByBackend}
        value={currentPick}
        onSelect={(pick) => void chooseModel(pick)}
      />
      {!(snapshot.isError && isMobile) ? (
        <Tooltip
          title={`Effort: ${effortLabel}`}
          description="How much the model reasons before it answers."
          position={TooltipPosition.TopCenter}
          sticky
          disabled={effortOpen}
        >
          <SmallSelect
            items={effortItems}
            value={currentEffort}
            placeholder="Default"
            disabled={controlsDisabled}
            size={ButtonSize.Small}
            trailingIcon={null}
            placement={PopoverPlacement.TopCenter}
            onOpenChange={setEffortOpen}
            onValueChange={(effort) => void chooseEffort(effort)}
          />
        </Tooltip>
      ) : null}
      {snapshot.isError ? (
        <Button
          size={ButtonSize.Small}
          variant={ButtonVariant.Ghost}
          content={isMobile ? ButtonContent.Icon : ButtonContent.Text}
          className={isMobile ? "min-h-11 min-w-11" : undefined}
          aria-label="Retry settings refresh"
          disabled={snapshot.isFetching}
          onClick={() => void snapshot.refetch()}
        >
          {isMobile ? <Icon iconName={IconName.Retry} /> : "Retry settings refresh"}
        </Button>
      ) : null}
      {!(snapshot.isError && isMobile) ? (
        <SpeedControl
          tiers={speedCapability.tiers}
          openAiApi={speedCapability.openAiApi}
          fastContextLimit={speedCapability.fastContextLimit}
          value={currentSpeed}
          disabled={controlsDisabled}
          onChange={(speed) => void chooseSpeed(speed)}
        />
      ) : null}
    </div>
  );
}
