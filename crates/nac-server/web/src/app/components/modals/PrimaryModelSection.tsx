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
import { providerLabel } from "@/app/lib/providers";
import { useManagedModelProfile } from "@/app/features/managed/controller/useManagedModelProfile";
import { useModelCatalog, useReadyManagedProviderModels } from "@/app/services/queries";
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
  initial,
  onChange,
}: {
  initial?: ConfigurationsPanelInitial;
  onChange: (selection: LaunchModelSelection | null) => void;
}) {
  const catalog = useModelCatalog();
  const managedModel = useManagedModelProfile();
  const liveByBackend = useReadyManagedProviderModels(catalog.data);
  const [chosen, setChosen] = useState<PrimaryChoice | null>(null);

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
  const fallback = useMemo(() => defaultCatalogPick(catalog.data), [catalog.data]);
  const effective = useMemo<PrimaryChoice | null>(
    () => chosen ?? initialChoice ?? (fallback ? { pick: fallback, effort: "" } : null),
    [chosen, initialChoice, fallback],
  );
  const provider = catalog.data?.providers.find((entry) => entry.id === effective?.pick.backend);
  const preservesInitialRoute = Boolean(
    initial && effective && effective.pick.backend === initial.backend,
  );
  const providerReady = Boolean(
    provider?.auth_status === "ready" ||
    (effective && managedModel.matches(effective.pick) && managedModel.credentialReady),
  );

  const selection = useMemo<LaunchModelSelection | null>(() => {
    if (!effective || !effective.pick.baseUrl) return null;
    if (preservesInitialRoute && initial) {
      return {
        kind: "resolved",
        backend: effective.pick.backend,
        model: effective.pick.model,
        base_url: initial.base_url,
        api_key_env: initial.api_key_env,
        reasoning_effort: effective.effort || null,
        extra_headers: initial.extra_headers,
        light_model: undefined,
      };
    }
    if (!providerReady) return null;
    return {
      kind: "resolved",
      backend: effective.pick.backend,
      model: effective.pick.model,
      base_url: effective.pick.baseUrl,
      // Provider accounts and conventional environment credentials are
      // resolved server-side; the browser never receives credential values.
      api_key_env: null,
      reasoning_effort: effective.effort || null,
      extra_headers: null,
      light_model: undefined,
    };
  }, [effective, initial, preservesInitialRoute, providerReady]);

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
      {effective && !preservesInitialRoute && !providerReady ? (
        <p className="text-micro text-error-primary" role="alert">
          Connect {providerLabel(effective.pick.backend)} in Advanced provider setup before
          selecting this model.
        </p>
      ) : null}
    </div>
  );
}
