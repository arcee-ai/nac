import type { SelectItem } from "../../atoms";
import type { ReasoningEffort } from "../../types/api";
export declare const BACKEND_OPTIONS: SelectItem[];
/** The providers themselves, for a row that has to name one. */
export declare const PROTOCOL_ITEMS: SelectItem[];
/** Just the effort levels, one per ReasoningEffort variant. */
export declare const EFFORT_LEVEL_OPTIONS: SelectItem[];
export declare const REASONING_OPTIONS: SelectItem[];
/**
 * Narrows the effort list to the levels the catalog says a model accepts. An
 * empty list means the catalog has nothing to say — an unknown model, or a
 * catalog that could not be read — and then every level stays offered.
 *
 * `current` survives the filter whatever the catalog says: a value already
 * configured has to remain selectable, or opening the form would silently
 * change it.
 */
export declare function reasoningOptionsFor(supported: readonly ReasoningEffort[], current: string, options?: SelectItem[]): SelectItem[];
