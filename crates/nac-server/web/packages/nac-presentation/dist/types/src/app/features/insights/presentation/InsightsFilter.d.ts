import type { InsightsFilterOption, InsightsFilter as InsightsFilterValue } from "../model/types";
/**
 * The filter select: "Show:" and its menu as a bar above the list on a
 * desktop and inline in the list's header on a tablet, and a floating pill
 * among a phone's header actions.
 */
export declare const InsightsFilter: import("react").MemoExoticComponent<({ options, value, onChange, }: {
    options: readonly InsightsFilterOption[];
    value: InsightsFilterValue;
    onChange: (filter: InsightsFilterValue) => void;
}) => import("react").JSX.Element>;
