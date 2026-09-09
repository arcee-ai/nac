import { useEffect, useMemo, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  PopoverPlacement,
  Select,
  type SelectItem,
} from "@/app/atoms";
import { CatalogModelPicker } from "@/app/components/modals/CatalogModelPicker";
import { ConfigRow, FieldLabel } from "@/app/components/modals/ConfigRow";
import { EFFORT_LEVEL_OPTIONS, reasoningOptionsFor } from "@/app/components/modals/options";
import {
  catalogBaseUrl,
  catalogProviderForModel,
  type CatalogPick,
  resolveCatalogModel,
} from "@/app/lib/catalog";
import { useModelCatalog, useReadyProviderModels } from "@/app/services/queries";
import type {
  LightModelSettings,
  ModelCatalog,
  ReasoningEffort,
  SessionBehavior,
} from "@/app/types/api";

export type LightMode = "single" | "dual";

/**
 * What the section reports upward. `light` is null while the dual form is
 * incomplete, so a submit can tell "single on purpose" from "not done yet".
 */
export interface LightSelection {
  mode: LightMode;
  light: LightModelSettings | null;
}

/** "" is the light model's default, so the list starts from it, not "inherit". */
const LIGHT_EFFORT_OPTIONS: SelectItem[] = [
  { id: "", label: "Model default" },
  ...EFFORT_LEVEL_OPTIONS,
];

interface LightState {
  pick: CatalogPick | null;
  effort: ReasoningEffort | "";
  apiKeyEnv: string | null;
}

/**
 * A stored light model may be sparse — backend and base_url are optional and
 * the server resolves them from the catalog — so missing fields are filled
 * the same way here once the catalog is available.
 */
function lightStateFrom(
  settings: LightModelSettings | null | undefined,
  catalog: ModelCatalog | undefined,
): LightState {
  if (!settings?.model) {
    return { pick: null, effort: "", apiKeyEnv: null };
  }
  const backend = settings.backend ?? catalogProviderForModel(catalog, settings.model);
  if (!backend) {
    return { pick: null, effort: "", apiKeyEnv: null };
  }
  const provider = catalog?.providers?.find((entry) => entry.id === backend);
  const baseUrl = settings.base_url ?? (provider ? catalogBaseUrl(provider) : "");
  return {
    pick: { backend, model: settings.model, baseUrl },
    effort: settings.reasoning_effort ?? "",
    apiKeyEnv: settings.api_key_env ?? null,
  };
}

function lightSettings(state: LightState): LightModelSettings | null {
  if (!state.pick) return null;
  return {
    model: state.pick.model,
    backend: state.pick.backend,
    base_url: state.pick.baseUrl || null,
    api_key_env: state.apiKeyEnv,
    reasoning_effort: state.effort || null,
  };
}

/**
 * The Single | Dual switch and, in dual mode, the light model row. Heavy
 * dispatches always run the session's own model, so the only extra choice is
 * the lighter one. Owns its form state and reports every change upward
 * through `onChange`.
 */
export function LightModelSection({
  initial,
  onChange,
  behavior = "orchestrator",
}: {
  /** Seeds the form; a value opens the section in dual mode. */
  initial?: LightModelSettings | null;
  onChange: (selection: LightSelection) => void;
  /** Adjusts the promise without changing the stored optional field. */
  behavior?: SessionBehavior;
}) {
  const catalog = useModelCatalog();
  const liveByBackend = useReadyProviderModels(catalog.data);
  const [mode, setMode] = useState<LightMode>(initial ? "dual" : "single");
  const [light, setLight] = useState<LightState>(() => lightStateFrom(initial, catalog.data));

  // A sparse stored light model needs the catalog to resolve its backend, and
  // the catalog may arrive after mount; while the user has not picked a model
  // yet the form falls back to its catalog-resolved seed.
  const effectiveLight = useMemo<LightState>(() => {
    if (light.pick) return light;
    const resolved = lightStateFrom(initial, catalog.data);
    return resolved.pick ? resolved : light;
  }, [light, initial, catalog.data]);

  const selection = useMemo<LightSelection>(() => {
    if (mode === "single") return { mode, light: null };
    return { mode, light: lightSettings(effectiveLight) };
  }, [mode, effectiveLight]);

  useEffect(() => {
    onChange(selection);
  }, [selection, onChange]);

  const efforts = reasoningOptionsFor(
    resolveCatalogModel(catalog.data, effectiveLight.pick?.backend, effectiveLight.pick?.model)
      .supportedEfforts,
    effectiveLight.effort,
    LIGHT_EFFORT_OPTIONS,
  );
  const copy =
    behavior === "direct"
      ? {
          label: "Optional light model",
          hint: "Saved with this chat, but plain direct sessions do not use it yet.",
          modelHint:
            "Preserved for future direct-session capabilities; it does not route current work.",
        }
      : behavior === "direct-with-orchestrator"
        ? {
            label: "Orchestrator models",
            hint: "Dual passes a lighter model to NAC orchestrators launched from this chat.",
            modelHint: "Runs dispatches that a launched NAC orchestrator classifies as light.",
          }
        : {
            label: "Worker models",
            hint: "Dual adds a lighter model for simple dispatches; the model above handles everything else.",
            modelHint: "Runs dispatches the orchestrator classifies as light.",
          };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <FieldLabel label={copy.label} hint={copy.hint} />
        <div className="flex items-center gap-2">
          {(["single", "dual"] as const).map((item) => (
            <Button
              key={item}
              variant={mode === item ? ButtonVariant.Primary : ButtonVariant.Secondary}
              size={ButtonSize.Medium}
              content={ButtonContent.Text}
              onClick={() => setMode(item)}
              aria-pressed={mode === item}
            >
              {item === "single" ? "Single" : "Dual"}
            </Button>
          ))}
        </div>
      </div>

      {mode === "dual" ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3">
          <ConfigRow
            label="Light model"
            required
            verticalOnMobile
            hint={copy.modelHint}
            control={
              <CatalogModelPicker
                catalog={catalog.data}
                loading={catalog.isLoading}
                failed={catalog.isError}
                liveByBackend={liveByBackend}
                value={effectiveLight.pick}
                onSelect={(pick) =>
                  setLight({
                    ...effectiveLight,
                    pick,
                    effort: "",
                    apiKeyEnv:
                      pick.backend === effectiveLight.pick?.backend
                        ? effectiveLight.apiKeyEnv
                        : (catalog.data?.providers.find((provider) => provider.id === pick.backend)
                            ?.connection?.api_key_env ?? null),
                  })
                }
              />
            }
          />
          <ConfigRow
            label="Light effort"
            secondary
            hint="Reasoning effort the light model runs with."
            control={
              <Select
                items={efforts}
                value={effectiveLight.effort}
                onValueChange={(effort) =>
                  setLight({
                    ...effectiveLight,
                    // SAFETY: the ids are built from the effort options, so
                    // every value the picker can emit is a ReasoningEffort.
                    effort: effort as ReasoningEffort | "",
                  })
                }
                disabled={!effectiveLight.pick}
                size={ButtonSize.Medium}
                variant={ButtonVariant.Ghost}
                placement={PopoverPlacement.BottomLeft}
                panelClassName="max-h-64 overflow-auto"
              />
            }
          />
        </div>
      ) : null}
    </div>
  );
}
