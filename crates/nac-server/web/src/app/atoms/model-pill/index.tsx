import type React from "react";
import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";

/** Pixel diameters of the avatar. */
export enum ModelPillSize {
  Small = 24,
  Medium = 36,
}

interface ModelPillProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: ModelPillSize;
  /** Swaps the static rim for a spinner while the orchestrator is working. */
  active?: boolean;
}

/** Round avatar for the orchestrator, shown beside every model message. */
const ModelPill: React.FC<ModelPillProps> & { Size: typeof ModelPillSize } = ({
  size = ModelPillSize.Medium,
  active = false,
  className = "",
  ...props
}) => (
  <div
    className={cn(
      "relative flex shrink-0 items-center justify-center rounded-full",
      active
        ? ""
        : "border-2 border-solid border-tertiary bg-[linear-gradient(to_bottom,var(--color-bg-divider-primary),transparent)]",
      className,
    )}
    style={{ width: size, height: size }}
    {...props}
  >
    <Icon iconName={IconName.Brain} size={size - 16} />
    {active ? (
      <div className="absolute inset-0 flex animate-spin items-center justify-center">
        <Icon iconName={IconName.Loader} size={size} />
      </div>
    ) : null}
  </div>
);

ModelPill.Size = ModelPillSize;

export default ModelPill;
