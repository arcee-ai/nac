import { memo, type HTMLAttributes } from "react";

import CircularLoader, { CircularLoaderVariant } from "@/app/atoms/loader/CircularLoader";
import { PILL_SIZE_MEDIUM_PX, PILL_SIZE_SMALL_PX } from "@/app/lib/agentSegments";
import { cn } from "@/app/lib/cn";
import Icon, { IconName } from "../icon";

export enum ToolPillSize {
  Medium = "medium",
  Small = "small",
}

export enum ToolPillState {
  Default = "default",
  Active = "active",
  Error = "error",
}

const sizeContainerPx: Record<ToolPillSize, number> = {
  [ToolPillSize.Medium]: PILL_SIZE_MEDIUM_PX,
  [ToolPillSize.Small]: PILL_SIZE_SMALL_PX,
};

const sizeIconPx: Record<ToolPillSize, number> = {
  [ToolPillSize.Medium]: 20,
  [ToolPillSize.Small]: 16,
};

interface ToolPillProps extends HTMLAttributes<HTMLDivElement> {
  icon: IconName;
  size?: ToolPillSize;
  state?: ToolPillState;
}

interface ToolPillOverflowProps extends HTMLAttributes<HTMLDivElement> {
  count: number;
  size?: ToolPillSize;
}

function pillContainerClasses(active: boolean, className: string): string {
  return cn(
    "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border",
    active ? "border-transparent" : "border-tertiary",
    className,
  );
}

function PillGradient() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 rounded-full bg-gradient-to-b from-[var(--white-trans-200)] to-transparent [html.light_&]:bg-gradient-to-t"
    />
  );
}

const ToolPill = memo(function ToolPill({
  icon,
  size = ToolPillSize.Medium,
  state = ToolPillState.Default,
  className = "",
  ...props
}: ToolPillProps) {
  const active = state === ToolPillState.Active;
  const error = state === ToolPillState.Error;
  const pixels = sizeContainerPx[size];

  return (
    <div
      className={pillContainerClasses(active, className)}
      data-state={state}
      style={{ width: pixels, height: pixels }}
      {...props}
    >
      {!active ? <PillGradient /> : null}
      <Icon
        aria-hidden="true"
        iconName={error ? IconName.Close : icon}
        size={sizeIconPx[size]}
        className={cn("relative", error ? "text-error-primary" : "text-basic-primary")}
      />
      {active ? (
        <CircularLoader
          aria-hidden="true"
          size={pixels}
          variant={CircularLoaderVariant.Neutral}
          className="absolute inset-0 m-auto"
        />
      ) : null}
    </div>
  );
});

const ToolPillOverflow = memo(function ToolPillOverflow({
  count,
  size = ToolPillSize.Medium,
  className = "",
  ...props
}: ToolPillOverflowProps) {
  const pixels = sizeContainerPx[size];
  return (
    <div
      className={pillContainerClasses(false, className)}
      data-overflow-count={count}
      style={{ width: pixels, height: pixels }}
      {...props}
    >
      <PillGradient />
      <span
        className={cn(
          "relative text-basic-primary tracking-tight",
          count >= 10 ? "text-[10px] leading-3" : "text-micro",
        )}
      >
        +{count}
      </span>
    </div>
  );
});

type ToolPillComponent = typeof ToolPill & {
  Size: typeof ToolPillSize;
  State: typeof ToolPillState;
  Overflow: typeof ToolPillOverflow;
};

const ToolPillWithParts = ToolPill as ToolPillComponent;
ToolPillWithParts.Size = ToolPillSize;
ToolPillWithParts.State = ToolPillState;
ToolPillWithParts.Overflow = ToolPillOverflow;

export default ToolPillWithParts;
