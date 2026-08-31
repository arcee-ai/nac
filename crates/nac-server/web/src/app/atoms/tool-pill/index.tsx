import React from "react";

import { cn } from "../../lib/cn";
import {
  PILL_SIZE_MEDIUM_PX,
  PILL_SIZE_SMALL_PX,
} from "../../lib/agentSegments";
import Icon, { IconName } from "../icon";
import CircularLoader, {
  CircularLoaderVariant,
} from "../loader/CircularLoader";
import { LoaderSize } from "../loader";

export enum ToolPillSize {
  Medium = "medium",
  Small = "small",
}

export enum ToolPillState {
  Default = "default",
  Active = "active",
}

const sizeContainerPx: Record<ToolPillSize, number> = {
  [ToolPillSize.Medium]: PILL_SIZE_MEDIUM_PX,
  [ToolPillSize.Small]: PILL_SIZE_SMALL_PX,
};

const sizeIconPx: Record<ToolPillSize, number> = {
  [ToolPillSize.Medium]: 20,
  [ToolPillSize.Small]: 16,
};

const sizeLoaderSize: Record<ToolPillSize, LoaderSize> = {
  [ToolPillSize.Medium]: LoaderSize.Large,
  [ToolPillSize.Small]: LoaderSize.Small,
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

const pillContainerClasses = (
  isActive: boolean,
  className: string,
  size: ToolPillSize,
) =>
  cn(
    "relative inline-flex items-center justify-center rounded-full shrink-0 overflow-hidden",
    size === ToolPillSize.Medium ? "border-2" : "border",
    isActive ? "border-transparent" : "border-accent-primary",
    className,
  );

const PillGradient: React.FC = () => (
  <div
    aria-hidden
    className="absolute inset-0 rounded-full bg-gradient-to-b from-[var(--brand-trans-500)] to-transparent [html.light_&]:bg-gradient-to-t"
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
  return (
    <div
      className={pillContainerClasses(isActive, className, size)}
      style={{ width: sizeContainerPx[size], height: sizeContainerPx[size] }}
      {...props}
    >
      {!isActive && <PillGradient />}
      <Icon
        iconName={icon}
        size={sizeIconPx[size]}
        color="var(--color-fill-accent-primary)"
        className="relative"
      />
      {isActive ? (
        <CircularLoader
          size={sizeLoaderSize[size]}
          variant={CircularLoaderVariant.Brand}
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
        "relative text-btn-accent tracking-tight",
        count >= 10 ? "label-micro" : "label-small",
      )}
    >
      +{count}
    </span>
  </div>
);

const MemoToolPill = React.memo(
  ToolPill,
) as React.NamedExoticComponent<ToolPillProps> & {
  Size: typeof ToolPillSize;
  State: typeof ToolPillState;
  Overflow: React.NamedExoticComponent<ToolPillOverflowProps>;
};

MemoToolPill.Size = ToolPillSize;
MemoToolPill.State = ToolPillState;
MemoToolPill.Overflow = React.memo(ToolPillOverflow);

export default MemoToolPill;
