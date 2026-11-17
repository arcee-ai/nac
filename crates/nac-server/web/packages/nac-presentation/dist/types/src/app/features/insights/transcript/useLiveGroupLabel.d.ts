import type { InsightGroup } from "../model/types";
/**
 * What a transcript badge says while its group is live, or null once it is
 * done. Only a turn that is still producing output has live groups. The one it
 * ends with stays live between two steps, naming its newest segment until the
 * next one starts.
 */
export declare function useLiveGroupLabel(group: InsightGroup, active: boolean, trailing: boolean): string | null;
