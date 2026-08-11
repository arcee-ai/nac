import { useEffect, useMemo, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  PopoverPlacement,
  Select,
  type SelectItem,
  Separator,
} from "@/app/atoms";
import { CatalogModelPicker } from "@/app/components/modals/CatalogModelPicker";
import { ConfigRow, FieldLabel } from "@/app/components/modals/ConfigRow";
import {
  EFFORT_LEVEL_OPTIONS,
  reasoningOptionsFor,
} from "@/app/components/modals/options";
import {
  catalogBaseUrl,
  catalogProviderForModel,
  resolveCatalogModel,
  type CatalogPick,
} from "@/app/lib/catalog";
import { useModelCatalog } from "@/app/services/queries";
import { MIXED_TIERS } from "@/app/types/api";
import type {
  MixedModels,
  MixedTierSettings,
  ModelCatalog,
  ReasoningEffort,
  ThreadComplexity,
} from "@/app/types/api";

export type MixedMode = "single" | "mixed";

/**
 * What the section reports upward. `mixed` is null while the mixed form is
 * incomplete, so a submit can tell "single on purpose" from "not done yet".
 */
export interface MixedSelection {
  mode: MixedMode;
  mixed: MixedModels | null;
}

type Tier = ThreadComplexity;

const TIER_LABELS: Record<Tier, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const TIER_HINTS: Record<Tier, string> = {
  easy: "Runs mechanical, well-scoped dispatches.",
  medium: "Runs typical implementation work.",
  hard: "Runs work needing deep reasoning or broad context.",
};

/** "" is the tier's model default, so the list starts from it, not "inherit". */
const TIER_EFFORT_OPTIONS: SelectItem[] = [
  { id: "", label: "Model default" },
  ...EFFORT_LEVEL_OPTIONS,
];

interface TierState {
  pick: CatalogPick | null;
  effort: ReasoningEffort | "";
  apiKeyEnv: string | null;
}

/**
 * A stored tier may omit `backend` and `base_url`, leaving them to the same
 * inference the runtime runs (`provider_for_model`, managed base URL); the
 * catalog answers both here so such a tier still opens filled in.
 */
function tierStateFrom(
  settings: MixedTierSettings | undefined,
  catalog: ModelCatalog | undefined,
): TierState {
  const backend =
    settings?.backend ??
    (settings?.model ? catalogProviderForModel(catalog, settings.model) : null);
  if (!settings?.model || !backend) {
    return { pick: null, effort: "", apiKeyEnv: null };
  }
  const provider = resolveCatalogModel(catalog, backend, settings.model).provider;
  return {
    pick: {
      backend,
      model: settings.model,
      baseUrl: settings.base_url ?? (provider ? catalogBaseUrl(provider) : ""),
    },
    effort: settings.reasoning_effort ?? "",
    apiKeyEnv: settings.api_key_env ?? null,
  };
}

function tierSettings(state: TierState): MixedTierSettings | null {
  if (!state.pick) return null;
  return {
    model: state.pick.model,
    backend: state.pick.backend,
    base_url: state.pick.baseUrl || null,
    api_key_env: state.apiKeyEnv,
    reasoning_effort: state.effort || null,
  };
}

function TierModelRow({
  tier,
  state,
  catalog,
  loading,
  failed,
  onChange,
}: {
  tier: Tier;
  state: TierState;
  catalog: ModelCatalog | undefined;
  loading: boolean;
  failed: boolean;
  onChange: (next: TierState) => void;
}) {
  const efforts = reasoningOptionsFor(
    resolveCatalogModel(catalog, state.pick?.backend, state.pick?.model)
      .supportedEfforts,
    state.effort,
    TIER_EFFORT_OPTIONS,
  );
  return (
    <>
      <ConfigRow
        label={`${TIER_LABELS[tier]} model`}
        required
        verticalOnMobile
        hint={TIER_HINTS[tier]}
        control={
          <CatalogModelPicker
            catalog={catalog}
            loading={loading}
            failed={failed}
            value={state.pick}
            onSelect={(pick) =>
              onChange({
                ...state,
                pick,
                effort: "",
                apiKeyEnv:
                  pick.backend === state.pick?.backend ? state.apiKeyEnv : null,
              })
            }
          />
        }
      />
      <ConfigRow
        label={`${TIER_LABELS[tier]} effort`}
        secondary
        hint="Reasoning effort this tier's model runs with."
        control={
          <Select
            items={efforts}
            value={state.effort}
            onValueChange={(effort) =>
              onChange({
                ...state,
                effort: effort as ReasoningEffort | "",
              })
            }
            disabled={!state.pick}
            size={ButtonSize.Medium}
            variant={ButtonVariant.Ghost}
            placement={PopoverPlacement.BottomLeft}
            panelClassName="max-h-64 overflow-auto"
          />
        }
      />
    </>
  );
}

/**
 * The Single | Mixed switch and, in mixed mode, the three tier model rows.
 * Owns its form state and reports every change upward through `onChange`.
 */
export function MixedModelsSection({
  initial,
  onChange,
}: {
  /** Seeds the form; a value opens the section in mixed mode. */
  initial?: MixedModels | null;
  onChange: (selection: MixedSelection) => void;
}) {
  const catalog = useModelCatalog();
  const [mode, setMode] = useState<MixedMode>(initial ? "mixed" : "single");
  // Only the user's edits are state; an untouched tier stays derived from the
  // seed, so a tier whose backend the catalog infers fills in once the
  // catalog arrives instead of opening blank.
  const [edits, setEdits] = useState<Partial<Record<Tier, TierState>>>({});
  const tiers = useMemo<Record<Tier, TierState>>(
    () => ({
      easy: edits.easy ?? tierStateFrom(initial?.easy, catalog.data),
      medium: edits.medium ?? tierStateFrom(initial?.medium, catalog.data),
      hard: edits.hard ?? tierStateFrom(initial?.hard, catalog.data),
    }),
    [edits, initial, catalog.data],
  );

  const selection = useMemo<MixedSelection>(() => {
    if (mode === "single") return { mode, mixed: null };
    const easy = tierSettings(tiers.easy);
    const medium = tierSettings(tiers.medium);
    const hard = tierSettings(tiers.hard);
    return {
      mode,
      mixed: easy && medium && hard ? { easy, medium, hard } : null,
    };
  }, [mode, tiers]);

  useEffect(() => {
    onChange(selection);
  }, [selection, onChange]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <FieldLabel
          label="Dispatch routing"
          hint="Mixed classifies every thread dispatch as easy, medium or hard and routes it to that tier's model."
        />
        <div className="flex items-center gap-2">
          {(["single", "mixed"] as const).map((item) => (
            <Button
              key={item}
              variant={
                mode === item ? ButtonVariant.Primary : ButtonVariant.Secondary
              }
              size={ButtonSize.Medium}
              content={ButtonContent.Text}
              onClick={() => setMode(item)}
              aria-pressed={mode === item}
            >
              {item === "single" ? "Single" : "Mixed"}
            </Button>
          ))}
        </div>
      </div>

      {mode === "mixed" ? (
        <div className="flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3">
          {MIXED_TIERS.map((tier, index) => (
            <div key={tier} className="flex flex-col gap-2">
              {index > 0 ? <Separator /> : null}
              <TierModelRow
                tier={tier}
                state={tiers[tier]}
                catalog={catalog.data}
                loading={catalog.isLoading}
                failed={catalog.isError}
                onChange={(next) =>
                  setEdits((current) => ({ ...current, [tier]: next }))
                }
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
