import { useEffect, useMemo, useState } from "react";

import { type SelectItem } from "@/app/atoms";
import { CatalogModelPicker } from "@/app/components/modals/CatalogModelPicker";
import {
  type ConfigurationsPanelInitial,
  type LaunchModelSelection,
} from "@/app/components/modals/ConfigurationsPanel";
import { ConfigRow, FieldLabel } from "@/app/components/modals/ConfigRow";
import { EFFORT_LEVEL_OPTIONS, reasoningOptionsFor } from "@/app/components/modals/options";
import { SmallSelect } from "@/app/components/modals/SmallSelect";
import { type CatalogPick, defaultCatalogPick, resolveCatalogModel } from "@/app/lib/catalog";
import { providerLabel, providerUsesApiKey } from "@/app/lib/providers";
import { useManagedModelProfile } from "@/app/features/managed/controller/useManagedModelProfile";
import {
  useModelCatalog,
  useModelConfigs,
  useResolvedModelConfig,
  useReadyProviderModels,
} from "@/app/services/queries";
import { savedModelSelection } from "@/app/features/setup/modelSelection";
import type { ReasoningEffort } from "@/app/types/api";

const PRIMARY_EFFORT_OPTIONS: SelectItem[] = [
  { id: "", label: "Model default" },
  ...EFFORT_LEVEL_OPTIONS,
];

interface PrimaryChoice {
  pick: CatalogPick;
  effort: ReasoningEffort | "";
}

/**
 * The ordinary primary-model control: one catalog spanning every configured
 * provider. Provider connection and advanced presets intentionally live
 * outside this component.
 */
export function PrimaryModelSection({
  initial: suppliedInitial,
  inheritSavedDefault = false,
  existingSession = false,
  onChange,
}: {
  initial?: ConfigurationsPanelInitial;
  inheritSavedDefault?: boolean;
  existingSession?: boolean;
  onChange: (selection: LaunchModelSelection | null) => void;
}) {
  const catalog = useModelCatalog();
  const managedModel = useManagedModelProfile();
  const liveByBackend = useReadyProviderModels(catalog.data);
  const [chosen, setChosen] = useState<PrimaryChoice | null>(null);
  const saved = useModelConfigs(inheritSavedDefault && !suppliedInitial);
  const latest =
    inheritSavedDefault && !suppliedInitial ? saved.data?.configurations.at(-1) : undefined;
  const initial = useMemo(
    () =>
      suppliedInitial ??
      (latest
        ? { ...savedModelSelection(latest), extra_headers: latest.extra_headers }
        : undefined),
    [suppliedInitial, latest],
  );
  const resolved = useResolvedModelConfig(latest && !chosen ? latest.config_id : null, "");
  const savedPending =
    inheritSavedDefault &&
    !suppliedInitial &&
    !chosen &&
    (saved.isPending || (latest && !resolved.data));

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
          ? { pick: managedDefault, effort: "" }
          : null
        : fallback
          ? { pick: fallback, effort: "" }
          : null),
    [chosen, initialChoice, fallback, managedDefault, managedModel.configured],
  );
  const provider = catalog.data?.providers.find((entry) => entry.id === effective?.pick.backend);
  const preservesInitialRoute = Boolean(
    initial && effective && effective.pick.backend === initial.backend,
  );
  const providerReady = Boolean(
    provider?.auth_status === "ready" ||
    (effective && managedModel.matches(effective.pick) && managedModel.credentialReady),
  );

  const isManagedPick = effective ? managedModel.matches(effective.pick) : false;
  const effectiveIndex =
    isManagedPick && effective ? liveByBackend.get(effective.pick.backend) : undefined;
  const selection = useMemo<LaunchModelSelection | null>(() => {
    if (savedPending || !effective || !effective.pick.baseUrl) return null;
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
        extra_headers: initial.extra_headers,
        light_model: initial.light_model,
        orchestrator_compaction_threshold: initial.orchestrator_compaction_threshold,
        config_id: initial.config_id,
      };
    }
    if (!providerReady) return null;
    return {
      kind: "resolved",
      backend: effective.pick.backend,
      model: effective.pick.model,
      base_url: effective.pick.baseUrl,
      allow_insecure_http: false,
      // Provider accounts and conventional environment credentials are
      // resolved server-side; the browser never receives credential values.
      api_key_env: provider?.connection?.api_key_env ?? null,
      reasoning_effort: effective.effort || null,
      extra_headers: null,
      light_model: undefined,
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
    savedPending,
  ]);

  useEffect(() => onChange(selection), [onChange, selection]);

  const efforts = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, effective?.pick.backend, effective?.pick.model)
      .supportedEfforts,
    effective?.effort ?? "",
    PRIMARY_EFFORT_OPTIONS,
  );

  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3">
      <FieldLabel
        label="Primary model"
        hint="Search one catalog across every connected provider. Provider accounts and advanced presets are managed separately below."
      />
      <ConfigRow
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
              setChosen({
                pick,
                effort: current && !supported.includes(current) ? "" : current,
              });
            }}
          />
        }
      />
      <ConfigRow
        label="Reasoning"
        hint="Stored with this chat and switchable independently of provider setup."
        control={
          <SmallSelect
            items={efforts}
            value={effective?.effort ?? ""}
            placeholder="Model default"
            disabled={!effective}
            onValueChange={(effort) => {
              if (!effective) return;
              setChosen({ ...effective, effort: effort as ReasoningEffort | "" });
            }}
          />
        }
      />
      {latest && resolved.isError ? (
        <p role="alert" className="text-micro text-error-primary">
          The saved project setup could not be resolved. Review it in Advanced or choose another
          model.
        </p>
      ) : null}
      {effective && !preservesInitialRoute && !providerReady ? (
        <p className="text-micro text-error-primary" role="alert">
          Connect {providerLabel(effective.pick.backend)} in Provider connections or Advanced before
          selecting this model.
        </p>
      ) : null}
    </div>
  );
}
