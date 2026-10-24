import type { MouseEvent } from "react";

import type { InsightsOpenOptions } from "@/app/features/insights/useInsightsNavigation";

/**
 * How a transcript control opens its entry in Insights. Enter and Space fire
 * the button's click without a press count (`detail` 0), and only that
 * activation moves focus into the detail.
 */
export function openOptionsFor(event: MouseEvent): InsightsOpenOptions | undefined {
  return event.detail === 0 ? { focusDetail: true } : undefined;
}
