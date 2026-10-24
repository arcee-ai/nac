import type React from "react";

import { cn } from "../../lib/cn";

export enum CodeChangesBadgeSize {
  Small = "small",
  Medium = "medium",
  Large = "large",
}

interface CodeChangesBadgeProps {
  /** Lines added. Left out, the badge drops the green count. */
  additions?: number | null;
  /** Lines removed. Left out, the badge drops the red count. */
  deletions?: number | null;
  size?: CodeChangesBadgeSize;
  className?: string;
}

/**
 * The design's Code-micro, Code-small and Code-medium: Plex Mono Medium at
 * 12/16, 14/20 and 16/24 without tracking. `.code` sets a 1.5 line height and
 * tracking in unlayered CSS, which only `!` utilities outrank.
 */
const TYPE: Record<CodeChangesBadgeSize, string> = {
  [CodeChangesBadgeSize.Small]: "text-xs !leading-4",
  [CodeChangesBadgeSize.Medium]: "text-sm !leading-5",
  [CodeChangesBadgeSize.Large]: "text-base !leading-6",
};

const isCount = (value: number | null | undefined): value is number => typeof value === "number";

const counted = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;

/** The counts as a screen reader says them, e.g. "279 additions, 84 deletions". */
export function codeChangesLabel(additions?: number | null, deletions?: number | null): string {
  return [
    isCount(additions) ? counted(additions, "addition") : null,
    isCount(deletions) ? counted(deletions, "deletion") : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * How many lines a change added and removed: `+additions` in the success
 * tone, `-deletions` in the error tone. Either count may be left out; with
 * neither the badge renders nothing. The signed numbers are for sight only,
 * assistive technology reads the counts spelled out.
 */
const CodeChangesBadge: React.FC<CodeChangesBadgeProps> = ({
  additions,
  deletions,
  size = CodeChangesBadgeSize.Small,
  className,
}) => {
  const label = codeChangesLabel(additions, deletions);
  if (!label) return null;

  return (
    <span
      className={cn(
        "code inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium !tracking-normal",
        TYPE[size],
        className,
      )}
    >
      {isCount(additions) ? (
        <span aria-hidden className="text-success-primary">
          +{additions}
        </span>
      ) : null}
      {isCount(deletions) ? (
        <span aria-hidden className="text-error-primary">
          -{deletions}
        </span>
      ) : null}
      <span className="sr-only">{label}</span>
    </span>
  );
};

export default CodeChangesBadge;
