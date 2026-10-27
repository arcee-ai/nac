import { memo, useId } from "react";

import { ButtonSize, ButtonVariant, Select } from "@/app/atoms";
import type {
  InsightsFilterOption,
  InsightsFilter as InsightsFilterValue,
} from "@/app/features/insights/model/types";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { AnchorPlacement } from "@/app/lib/anchor";
import { cn } from "@/app/lib/cn";

/**
 * "Show:" and the filter select: a bar above the list on a pointer, a pill
 * floating over its last rows on a phone.
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
  const labelId = useId();
  const items = options.map((option) => ({
    id: option.value,
    label: option.label,
  }));
  const select = (id: string) => {
    const option = options.find((candidate) => candidate.value === id);
    if (option) onChange(option.value);
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={
        isMobile
          ? "flex w-fit items-center gap-2 rounded-full bg-elevation-level-3 py-1 pl-4 pr-1 shadow-2xl"
          : "flex h-14 shrink-0 items-center gap-3 border-b border-muted pl-3 pr-2"
      }
    >
      <span id={labelId} className={cn("label-micro text-basic-primary", !isMobile && "flex-1")}>
        Show:
      </span>
      <Select
        items={items}
        value={value}
        onValueChange={select}
        size={isMobile ? ButtonSize.Medium : ButtonSize.Small}
        variant={isMobile ? ButtonVariant.Secondary : ButtonVariant.Ghost}
        placement={isMobile ? AnchorPlacement.TopRight : AnchorPlacement.BottomLeft}
        sticky={isMobile}
      />
    </div>
  );
});
