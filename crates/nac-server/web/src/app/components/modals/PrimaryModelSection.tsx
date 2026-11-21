import { useEffect, useMemo, useState } from "react";

import { type SelectItem } from "@/app/atoms";
import { FormSection } from "@/app/components/modals/FormSection";
import { CatalogModelPicker } from "@/app/components/modals/CatalogModelPicker";
import {
  type SessionModelInitial,
  type LaunchModelSelection,
} from "@/app/features/setup/modelSelection";
import { ConfigRow } from "@/app/components/modals/ConfigRow";
import { EFFORT_LEVEL_OPTIONS, reasoningOptionsFor } from "@/app/components/modals/options";
import { SpeedControl } from "@/app/components/modals/SpeedControl";
import {
  providerSpeedProfiles,
  speedForRoute,
  supportsSpeed,
  type ServiceTier,
} from "@/app/lib/serviceTier";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { type CatalogPick, defaultCatalogPick, resolveCatalogModel } from "@/app/lib/catalog";
import { providerLabel, providerUsesApiKey } from "@/app/lib/providers";
import { useManagedModelProfile } from "@/app/features/managed/controller/useManagedModelProfile";
import { useModelCatalog, useReadyProviderModels } from "@/app/services/queries";
import type { ReasoningEffort } from "@/app/types/api";

const PRIMARY_EFFORT_OPTIONS: SelectItem[] = [
  { id: "", label: "Model default" },
  ...EFFORT_LEVEL_OPTIONS,
];

interface PrimaryChoice {
  pick: CatalogPick;
  effort: ReasoningEffort | "";
  speed: ServiceTier | null | undefined;
}

/**
 * The ordinary primary-model control: one catalog spanning every configured
 * provider. Provider connections live outside this component.
 */
export function PrimaryModelSection({
  initial: suppliedInitial,
  existingSession = false,
  onChange,
}: {
  initial?: SessionModelInitial;
  existingSession?: boolean;
  onChange: (selection: LaunchModelSelection | null) => void;
}) {
  const catalog = useModelCatalog();
  const managedModel = useManagedModelProfile();
  const liveByBackend = useReadyProviderModels(catalog.data);
  const [chosen, setChosen] = useState<PrimaryChoice | null>(null);
  const [speedNotice, setSpeedNotice] = useState("");
  const initial = suppliedInitial;

  const initialChoice = useMemo<PrimaryChoice | null>(
    () =>
      initial
        ? {
            pick: {
              backend: initial.backend,
              model: initial.model,
              baseUrl: initial.base_url,
            },
            effort: (initial.reasoning_effort ?? "") as ReasoningEffort | "",
            speed: initial.service_tier,
          }
        : null,
    [initial],
  );
  const managedIndex = managedModel.defaultPick
    ? liveByBackend.get(managedModel.defaultPick.backend)
    : undefined;
  const managedPending =
    managedModel.configured &&
    managedModel.credentialReady &&
    (catalog.isPending || managedIndex === null);
  const managedDefault =
    managedIndex === undefined ||
    (managedModel.defaultPick &&
      managedIndex?.some((entry) => entry.id === managedModel.defaultPick?.model))
      ? managedModel.defaultPick
      : null;
  const fallback = useMemo(() => defaultCatalogPick(catalog.data), [catalog.data]);
  const effective = useMemo<PrimaryChoice | null>(
    () =>
      chosen ??
      initialChoice ??
      (managedModel.configured
        ? managedDefault
          ? { pick: managedDefault, effort: "", speed: undefined }
          : null
        : fallback
          ? { pick: fallback, effort: "", speed: undefined }
          : null),
    [chosen, initialChoice, fallback, managedDefault, managedModel.configured],
  );
  const provider = catalog.data?.providers.find((entry) => entry.id === effective?.pick.backend);
  const preservesInitialRoute = Boolean(
    initial &&
    effective &&
    effective.pick.backend === initial.backend &&
    effective.pick.baseUrl === initial.base_url,
  );
  const providerReady = Boolean(
    provider?.auth_status === "ready" ||
    (effective && managedModel.matches(effective.pick) && managedModel.credentialReady),
  );

  const isManagedPick = effective ? managedModel.matches(effective.pick) : false;
  const effectiveIndex =
    isManagedPick && effective ? liveByBackend.get(effective.pick.backend) : undefined;
  const selection = useMemo<LaunchModelSelection | null>(() => {
    if (!effective || !effective.pick.baseUrl) return null;
    // An existing exact route stays editable without provider login. Readiness
    // still gates new choices; server validation owns actual model transitions.
    const existingRoute = Boolean(
      existingSession && initial && preservesInitialRoute && effective.pick.model === initial.model,
    );
    if (!existingRoute && (managedModel.initializing || managedPending)) return null;
    if (!existingRoute && isManagedPick) {
      const index = effectiveIndex;
      if (
        !managedModel.credentialReady ||
        index === null ||
        (index && !index.some((entry) => entry.id === effective.pick.model))
      )
        return null;
    }
    if (!existingRoute && !providerUsesApiKey(effective.pick.backend) && !providerReady)
      return null;
    if (preservesInitialRoute && initial) {
      return {
        kind: "resolved",
        backend: effective.pick.backend,
        model: effective.pick.model,
        base_url: initial.base_url,
        allow_insecure_http: initial.allow_insecure_http ?? false,
        api_key_env: initial.api_key_env,
        reasoning_effort: effective.effort || null,
        ...(effective.speed !== undefined ? { service_tier: effective.speed } : {}),
        extra_headers: initial.extra_headers,
        compaction_threshold: initial.compaction_threshold,
      };
    }
    if (!providerReady) return null;
    return {
      kind: "resolved",
      backend: effective.pick.backend,
      model: effective.pick.model,
      base_url: effective.pick.baseUrl,
      allow_insecure_http:
        provider?.connection?.base_url === effective.pick.baseUrl
          ? (provider.connection.allow_insecure_http ?? false)
          : false,
      // Provider accounts and conventional environment credentials are
      // resolved server-side; the browser never receives credential values.
      api_key_env: provider?.connection?.api_key_env ?? null,
      reasoning_effort: effective.effort || null,
      ...(effective.speed !== undefined ? { service_tier: effective.speed } : {}),
      extra_headers: null,
    };
  }, [
    effective,
    initial,
    existingSession,
    preservesInitialRoute,
    provider,
    providerReady,
    managedModel.initializing,
    managedModel.credentialReady,
    isManagedPick,
    managedPending,
    effectiveIndex,
  ]);

  useEffect(() => onChange(selection), [onChange, selection]);

  const efforts = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, effective?.pick.backend, effective?.pick.model)
      .supportedEfforts,
    effective?.effort ?? "",
    PRIMARY_EFFORT_OPTIONS,
  );
  const speedCapability = speedForRoute(
    resolveCatalogModel(catalog.data, effective?.pick.backend, effective?.pick.model).model,
    effective?.pick.model ?? "",
    effective?.pick.backend,
    preservesInitialRoute ? initial?.base_url : effective?.pick.baseUrl,
    providerSpeedProfiles(provider),
  );

  return (
    <FormSection
      title="Primary model"
      description="Choose a model for this session from your connected providers."
    >
      <ConfigRow
        presentation="form"
        label="Model"
        required
        verticalOnMobile
        control={
          <CatalogModelPicker
            catalog={catalog.data}
            loading={catalog.isLoading}
            failed={catalog.isError}
            liveByBackend={liveByBackend}
            value={effective?.pick ?? null}
            onSelect={(pick) => {
              const supported = resolveCatalogModel(
                catalog.data,
                pick.backend,
                pick.model,
              ).supportedEfforts;
              const current = effective?.effort ?? "";
              const oldSpeed = effective?.speed;
              const target = speedForRoute(
                resolveCatalogModel(catalog.data, pick.backend, pick.model).model,
                pick.model,
                pick.backend,
                initial && pick.backend === initial.backend && pick.baseUrl === initial.base_url
                  ? initial.base_url
                  : pick.baseUrl,
                providerSpeedProfiles(
                  catalog.data?.providers.find((entry) => entry.id === pick.backend),
                ),
              );
              const tiers = target.tiers;
              if (oldSpeed && pick.backend !== "chatgpt-codex-responses" && !target.openAiApi) {
                setSpeedNotice("Clear the speed preference before choosing this model.");
                return;
              }
              const nextSpeed = oldSpeed && !supportsSpeed(tiers, oldSpeed) ? "standard" : oldSpeed;
              setSpeedNotice(
                nextSpeed !== oldSpeed ? "Speed reset to Standard for the selected model." : "",
              );
              setChosen({
                pick,
                effort: current && !supported.includes(current) ? "" : current,
                speed: nextSpeed,
              });
            }}
          />
        }
      />
      <ConfigRow
        presentation="form"
        label="Reasoning"
        hint="Stored with this chat and switchable independently of provider setup."
        control={
          <SmallSelect
            presentation="form"
            items={efforts}
            value={effective?.effort ?? ""}
            placeholder="Model default"
            disabled={!effective}
            onValueChange={(effort) => {
              if (!effective) return;
              setChosen({
                ...effective,
                effort: effort as ReasoningEffort | "",
              });
            }}
          />
        }
      />
      {effective?.pick.backend === "chatgpt-codex-responses" ||
      speedCapability.openAiApi ||
      effective?.speed ? (
        <ConfigRow
          presentation="form"
          label="Speed"
          hint="Use provider default to clear the speed override."
          control={
            <SpeedControl
              form
              tiers={speedCapability.tiers}
              openAiApi={speedCapability.openAiApi}
              fastContextLimit={speedCapability.fastContextLimit}
              value={effective?.speed ?? null}
              onChange={(speed) => {
                if (effective) setChosen({ ...effective, speed });
              }}
            />
          }
        />
      ) : null}
      {speedNotice ? <p role="status">{speedNotice}</p> : null}
      {effective && !preservesInitialRoute && !providerReady ? (
        <p className="text-small !leading-[22px] text-error-primary" role="alert">
          Connect {providerLabel(effective.pick.backend)} in Provider connections before selecting
          this model.
        </p>
      ) : null}
    </FormSection>
  );
}
