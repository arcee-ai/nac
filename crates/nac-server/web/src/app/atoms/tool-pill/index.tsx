import React from "react";

import { cn } from "../../lib/cn";
import { PILL_SIZE_MEDIUM_PX, PILL_SIZE_SMALL_PX } from "../../lib/agentSegments";
import Icon, { IconName } from "../icon";
import CircularLoader, { CircularLoaderVariant } from "../loader/CircularLoader";

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

const sizeLoaderPx: Record<ToolPillSize, number> = {
  [ToolPillSize.Medium]: PILL_SIZE_MEDIUM_PX,
  [ToolPillSize.Small]: PILL_SIZE_SMALL_PX,
};

interface ToolPillProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: IconName;
  size?: ToolPillSize;
  state?: ToolPillState;
}

interface ToolPillOverflowProps extends React.HTMLAttributes<HTMLDivElement> {
  count: number;
  size?: ToolPillSize;
}

const pillContainerClasses = (isActive: boolean, className: string, size: ToolPillSize) =>
  cn(
    "relative inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden",
    size === ToolPillSize.Medium ? "border" : "border",
    isActive ? "border-transparent" : "border-tertiary",
    className,
  );

const PillGradient: React.FC = () => (
  <div
    aria-hidden
    className="absolute inset-0 rounded-full bg-gradient-to-b from-[var(--white-trans-200)] to-transparent [html.light_&]:bg-gradient-to-t"
  />
);

const ToolPill: React.FC<ToolPillProps> = ({
  icon,
  size = ToolPillSize.Medium,
  state = ToolPillState.Default,
  className = "",
  ...props
}) => {
  const isActive = state === ToolPillState.Active;
  const isError = state === ToolPillState.Error;
  return (
    <div
      className={pillContainerClasses(isActive, className, size)}
      style={{ width: sizeContainerPx[size], height: sizeContainerPx[size] }}
      {...props}
    >
      {!isActive && <PillGradient />}
      <Icon
        iconName={isError ? IconName.Close : icon}
        size={sizeIconPx[size]}
        className={cn(
          "relative",
          isError ? "[&>path]:!fill-error-primary" : "[&>path]:!fill-basic-primary",
        )}
      />
      {isActive ? (
        <CircularLoader
          size={sizeLoaderPx[size]}
          variant={CircularLoaderVariant.Neutral}
          className="absolute inset-0 m-auto"
        />
      ) : null}
    </div>
  );
};

const ToolPillOverflow: React.FC<ToolPillOverflowProps> = ({
  count,
  size = ToolPillSize.Medium,
  className = "",
  ...props
}) => (
  <div
    className={pillContainerClasses(false, className, size)}
    style={{ width: sizeContainerPx[size], height: sizeContainerPx[size] }}
    {...props}
  >
    <PillGradient />
    <span
      className={cn(
        "relative text-basic-primary tracking-tight",
        count >= 10 ? "text-micro text-[10px] leading-[12px]" : "text-micro",
      )}
    >
      +{count}
    </span>
  </div>
);

const MemoToolPill = React.memo(ToolPill) as React.NamedExoticComponent<ToolPillProps> & {
  Size: typeof ToolPillSize;
  State: typeof ToolPillState;
  Overflow: React.NamedExoticComponent<ToolPillOverflowProps>;
};

MemoToolPill.Size = ToolPillSize;
MemoToolPill.State = ToolPillState;
MemoToolPill.Overflow = React.memo(ToolPillOverflow);

export default MemoToolPill;
