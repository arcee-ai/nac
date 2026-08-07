import type { SelectItem } from "@/app/atoms";
import { CLEAR_EFFORT } from "@/app/lib/modelConfig";
import { PROVIDER_KINDS, providerLabel } from "@/app/lib/providers";
import type { ReasoningEffort } from "@/app/types/api";

// Backend and reasoning-effort choices mirror nac-core's serde enums
// (BackendKind = kebab-case, ReasoningEffort = lowercase).
export const BACKEND_OPTIONS: SelectItem[] = [
  { id: "", label: "Inherit config" },
  ...PROVIDER_KINDS.map((kind) => ({ id: kind, label: providerLabel(kind) })),
];

/** Just the effort levels, one per ReasoningEffort variant. */
export const EFFORT_LEVEL_OPTIONS: SelectItem[] = [
  { id: "none", label: "None" },
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "X-High" },
];

export const REASONING_OPTIONS: SelectItem[] = [
  { id: "", label: "Inherit config" },
  { id: CLEAR_EFFORT, label: "Clear configured effort" },
  ...EFFORT_LEVEL_OPTIONS,
];

/** The choices that are not an effort level, and so always apply. */
const REASONING_ACTIONS: ReadonlySet<string> = new Set(["", CLEAR_EFFORT]);

/**
 * Narrows the effort list to the levels the catalog says a model accepts. An
 * empty list means the catalog has nothing to say — an unknown model, or a
 * catalog that could not be read — and then every level stays offered.
 *
 * `current` survives the filter whatever the catalog says: a value already
 * configured has to remain selectable, or opening the form would silently
 * change it.
 */
export function reasoningOptionsFor(
  supported: readonly ReasoningEffort[],
  current: string,
  options: SelectItem[] = REASONING_OPTIONS,
): SelectItem[] {
  if (supported.length === 0) return options;
  const allowed = new Set<string>(supported);
  return options.filter(
    (item) =>
      REASONING_ACTIONS.has(String(item.id)) ||
      allowed.has(String(item.id)) ||
      item.id === current,
  );
}