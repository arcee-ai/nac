import { useMemo } from "react";

import { groupLiveLabel, inProgressLabel } from "@/app/features/insights/model/labels";
import type { InsightGroup } from "@/app/features/insights/model/types";

/**
 * What a transcript badge says while its group is live, or null once it is
 * done. Only a turn that is still producing output has live groups. The one it
 * ends with stays live between two steps, naming its newest segment until the
 * next one starts.
 */
export function useLiveGroupLabel(
  group: InsightGroup,
  active: boolean,
  trailing: boolean,
): string | null {
  return useMemo(() => {
    if (!active) return null;
    const live = groupLiveLabel(group);
    if (live !== null || !trailing) return live;
    const newest = group.segments.at(-1);
    return newest ? inProgressLabel(newest) : null;
  }, [group, active, trailing]);
}
