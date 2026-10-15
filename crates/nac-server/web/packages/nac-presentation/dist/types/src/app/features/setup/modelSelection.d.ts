import type { LaunchModelSelection } from "../../components/modals/ConfigurationsPanel.js";
import type { ModelConfigurationRecord } from "../../types/api.js";
/** A persisted preset carries selectors, never credential values. */
export declare function savedModelSelection(record: ModelConfigurationRecord): Extract<LaunchModelSelection, {
    kind: "resolved";
}>;
/**
 * Compare effective values, never insertion order. Undefined means inheritance.
 * Callers store selection metadata separately; a discovered preset ID must not
 * reseed local edits when the effective tuple is unchanged.
 */
export declare function sameModelSelection(left: LaunchModelSelection | null, right: LaunchModelSelection | null): boolean;
