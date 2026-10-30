import { memo, useId } from "react";

import { ButtonSize, ButtonVariant, Select } from "@/app/atoms";
import type {
  InsightsFilterOption,
  InsightsFilter as InsightsFilterValue,
} from "@/app/features/insights/model/types";
import { useIsMobile, useIsTablet } from "@/app/hooks/useMediaQuery";
import { AnchorPlacement } from "@/app/lib/anchor";
import { cn } from "@/app/lib/cn";

/** The phone pill names the filter itself: "Show All", "Show Threads". */
function pillLabel(options: readonly InsightsFilterOption[], value: InsightsFilterValue): string {
  const current = options.find((option) => option.value === value);
  return `Show ${!current || current.value === "all" ? "All" : current.label}`;
}

/**
 * The filter select: "Show:" and its menu as a bar above the list on a
 * desktop and inline in the list's header on a tablet, and a floating pill
 * among a phone's header actions.
 */
export const InsightsFilter = memo(function InsightsFilter({
  options,
  value,
  onChange,
}: {
  options: readonly InsightsFilterOption[];
  value: InsightsFilterValue;
  onChange: (filter: InsightsFilterValue) => void;
}) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const labelId = useId();
  const items = options.map((option) => ({
    id: option.value,
    label: option.label,
  }));
  const select = (id: string) => {
    const option = options.find((candidate) => candidate.value === id);
    if (option) onChange(option.value);
  };

  if (isMobile) {
    return (
      <Select
        items={items}
        value={value}
        onValueChange={select}
        size={ButtonSize.Large}
        variant={ButtonVariant.Ghost}
        floating
        triggerLabel={pillLabel(options, value)}
      />
    );
  }
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={cn(
        "flex min-w-0 items-center gap-3",
        isTablet ? "flex-1" : "h-14 shrink-0 border-b border-muted pl-3 pr-2",
      )}
    >
      <span id={labelId} className="flex-1 label-micro text-basic-tertiary">
        Show:
      </span>
      <Select
        items={items}
        value={value}
        onValueChange={select}
        size={ButtonSize.Small}
        variant={ButtonVariant.Ghost}
        placement={AnchorPlacement.BottomLeft}
      />
    </div>
  );
});
