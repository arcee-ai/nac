// Mixed-mode dispatch routing. The orchestrator classifies every thread
// dispatch as easy, medium or hard, and the classification selects either a
// worker model per tier ("models") or a reasoning effort per tier on the
// session's single model ("efforts") — never both. Models come out of the
// catalog, so effort menus only offer the levels the relevant model accepts.

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
import {
  CatalogModelPicker,
  type CatalogPick,
} from "@/app/components/modals/CatalogModelPicker";
import { ConfigRow, FieldLabel } from "@/app/components/modals/ConfigRow";
import {
  EFFORT_LEVEL_OPTIONS,
  reasoningOptionsFor,
} from "@/app/components/modals/options";
import { resolveCatalogModel } from "@/app/lib/catalog";
import { useModelCatalog } from "@/app/services/queries";
import type {
  MixedModels,
  MixedTierSettings,
  ModelCatalog,
} from "@/app/types/api";

export type MixedMode = "single" | "mixed";
type MixedVariant = "models" | "efforts";

/**
 * What the section reports upward. `mixed` is null while the mixed form is
 * incomplete, so a submit can tell "single on purpose" from "not done yet".
 */
export interface MixedSelection {
  mode: MixedMode;
  mixed: MixedModels | null;
}

/** The session's single model; the efforts variant runs it per tier. */
export interface MixedPrimaryModel {
  backend?: string | null;
  model?: string | null;
}

const TIERS = ["easy", "medium", "hard"] as const;
type Tier = (typeof TIERS)[number];

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

/** The efforts variant requires a level per tier, so there is no default row. */
const REQUIRED_EFFORT_OPTIONS: SelectItem[] = EFFORT_LEVEL_OPTIONS;

interface TierState {
  pick: CatalogPick | null;
  effort: string;
}

function tierStateFrom(settings: MixedTierSettings | undefined): TierState {
  if (!settings?.model || !settings.backend) {
    return { pick: null, effort: "" };
  }
  return {
    pick: {
      backend: settings.backend as CatalogPick["backend"],
      model: settings.model,
      baseUrl: settings.base_url ?? "",
    },
    effort: settings.reasoning_effort ?? "",
  };
}

function tierSettings(state: TierState): MixedTierSettings | null {
  if (!state.pick || !state.pick.baseUrl) return null;
  return {
    model: state.pick.model,
    backend: state.pick.backend,
    base_url: state.pick.baseUrl,
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
        hint={TIER_HINTS[tier]}
        control={
          <CatalogModelPicker
            catalog={catalog}
            loading={loading}
            failed={failed}
            value={state.pick}
            onSelect={(pick) => onChange({ ...state, pick, effort: "" })}
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
            onValueChange={(effort) => onChange({ ...state, effort })}
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

function initialVariant(initial: MixedModels | null | undefined): MixedVariant {
  return initial?.kind === "efforts" ? "efforts" : "models";
}

function initialEfforts(
  initial: MixedModels | null | undefined,
): Record<Tier, string> {
  if (initial?.kind === "efforts") {
    return { easy: initial.easy, medium: initial.medium, hard: initial.hard };
  }
  return { easy: "", medium: "", hard: "" };
}

function initialTiers(
  initial: MixedModels | null | undefined,
): Record<Tier, TierState> {
  const models = initial?.kind === "models" ? initial : null;
  return {
    easy: tierStateFrom(models?.easy),
    medium: tierStateFrom(models?.medium),
    hard: tierStateFrom(models?.hard),
  };
}

/**
 * The Single | Mixed switch and, in mixed mode, either the three tier model
 * rows or the three tier effort rows. Owns its form state and reports every
 * change upward through `onChange`.
 */
export function MixedModelsSection({
  initial,
  primary,
  onChange,
}: {
  /** Seeds the form; a value opens the section in mixed mode. */
  initial?: MixedModels | null;
  /** The session's single model; narrows the efforts variant's menus. */
  primary?: MixedPrimaryModel | null;
  onChange: (selection: MixedSelection) => void;
}) {
  const catalog = useModelCatalog();
  const [mode, setMode] = useState<MixedMode>(initial ? "mixed" : "single");
  const [variant, setVariant] = useState<MixedVariant>(initialVariant(initial));
  const [tiers, setTiers] = useState<Record<Tier, TierState>>(
    initialTiers(initial),
  );
  const [efforts, setEfforts] = useState<Record<Tier, string>>(
    initialEfforts(initial),
  );

  const primarySupported = resolveCatalogModel(
    catalog.data,
    primary?.backend,
    primary?.model,
  ).supportedEfforts;
  const primaryEffortOptions = reasoningOptionsFor(
    primarySupported,
    "",
    REQUIRED_EFFORT_OPTIONS,
  );

  const selection = useMemo<MixedSelection>(() => {
    if (mode === "single") return { mode, mixed: null };
    if (variant === "efforts") {
      const complete = TIERS.every((tier) => efforts[tier]);
      return {
        mode,
        mixed: complete ? { kind: "efforts", ...efforts } : null,
      };
    }
    const easy = tierSettings(tiers.easy);
    const medium = tierSettings(tiers.medium);
    const hard = tierSettings(tiers.hard);
    return {
      mode,
      mixed:
        easy && medium && hard
          ? { kind: "models", easy, medium, hard }
          : null,
    };
  }, [mode, variant, tiers, efforts]);

  useEffect(() => {
    onChange(selection);
  }, [selection, onChange]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <FieldLabel
          label="Dispatch routing"
          hint="Mixed classifies every thread dispatch as easy, medium or hard and routes it to that tier's model or reasoning effort."
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
          <ConfigRow
            label="Vary by tier"
            hint="Models runs a different model per tier; reasoning runs the session model at a different effort per tier."
            control={
              <div className="flex items-center gap-2">
                {(["models", "efforts"] as const).map((item) => (
                  <Button
                    key={item}
                    variant={
                      variant === item
                        ? ButtonVariant.Primary
                        : ButtonVariant.Secondary
                    }
                    size={ButtonSize.Medium}
                    content={ButtonContent.Text}
                    onClick={() => setVariant(item)}
                    aria-pressed={variant === item}
                  >
                    {item === "models" ? "Models" : "Reasoning"}
                  </Button>
                ))}
              </div>
            }
          />
          {variant === "models"
            ? TIERS.map((tier, index) => (
                <div key={tier} className="flex flex-col gap-2">
                  {index > 0 ? <Separator /> : null}
                  <TierModelRow
                    tier={tier}
                    state={tiers[tier]}
                    catalog={catalog.data}
                    loading={catalog.isLoading}
                    failed={catalog.isError}
                    onChange={(next) =>
                      setTiers((current) => ({ ...current, [tier]: next }))
                    }
                  />
                </div>
              ))
            : TIERS.map((tier) => (
                <ConfigRow
                  key={tier}
                  label={`${TIER_LABELS[tier]} effort`}
                  required
                  hint={TIER_HINTS[tier]}
                  control={
                    <Select
                      items={primaryEffortOptions}
                      value={efforts[tier]}
                      onValueChange={(effort) =>
                        setEfforts((current) => ({
                          ...current,
                          [tier]: effort,
                        }))
                      }
                      size={ButtonSize.Medium}
                      variant={ButtonVariant.Ghost}
                      placement={PopoverPlacement.BottomLeft}
                      panelClassName="max-h-64 overflow-auto"
                    />
                  }
                />
              ))}
          {variant === "efforts" && primarySupported.length === 0 ? (
            <p className="text-micro text-basic-muted !my-0">
              The catalog has no effort data for this model, so every level is
              offered; unsupported levels are rejected when you save.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
