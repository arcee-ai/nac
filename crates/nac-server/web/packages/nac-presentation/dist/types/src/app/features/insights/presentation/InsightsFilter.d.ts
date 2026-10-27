import type { InsightsFilterOption, InsightsFilter as InsightsFilterValue } from "../model/types";
/**
 * "Show:" and the filter select: a bar above the list on a pointer, a pill
 * floating over its last rows on a phone.
 */
export declare const InsightsFilter: import("react").MemoExoticComponent<({ options, value, onChange, }: {
    options: readonly InsightsFilterOption[];
    value: InsightsFilterValue;
    onChange: (filter: InsightsFilterValue) => void;
}) => import("react").JSX.Element>;
