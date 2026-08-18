import type React from "react";
import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import CircularLoader from "../loader/CircularLoader";
import { LoaderSize } from "../loader";

/** Pixel diameters of the avatar. */
export enum ModelPillSize {
  Small = 24,
  Medium = 32,
}

interface ModelPillProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: ModelPillSize;
  /** Swaps the static rim for a spinner while the orchestrator is working. */
  active?: boolean;
}

const sizeIconPx = {
  [ModelPillSize.Medium]: 16,
  [ModelPillSize.Small]: 18,
} satisfies Record<ModelPillSize, number>;

const sizeLoaderSize = {
  [ModelPillSize.Medium]: LoaderSize.Large,
  [ModelPillSize.Small]: LoaderSize.Small,
} satisfies Record<ModelPillSize, LoaderSize>;

/** Round avatar for the orchestrator, shown beside every model message. */
const ModelPill: React.FC<ModelPillProps> & { Size: typeof ModelPillSize } = ({
  size = ModelPillSize.Medium,
  active = false,
  className = "",
  ...props
}) => (
  <div
    className={cn(
      "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
      size === ModelPillSize.Medium ? "border" : "border",
      active ? "border-transparent" : "border-secondary",
      className,
    )}
    style={{ width: size, height: size }}
    {...props}
  >
    {/* Active pills already carry the spinning CircularLoader as their visual
        anchor, so we drop the brand gradient there to avoid layering two
        attention-grabbing effects on top of each other. */}
    {!active ? (
      <div
        aria-hidden
        className="absolute inset-0 rounded-full bg-gradient-to-b from-[var(--color-fill-basic-muted)] to-transparent [html.light_&]:bg-gradient-to-t"
      />
    ) : null}
    <Icon
      iconName={IconName.Brain}
      size={sizeIconPx[size]}
      color="var(--color-fill-basic-primary)"
      className="relative"
    />
    {active ? (
      <CircularLoader size={sizeLoaderSize[size]} className="absolute inset-0 m-auto" />
    ) : null}
  </div>
);

ModelPill.Size = ModelPillSize;

export default ModelPill;
