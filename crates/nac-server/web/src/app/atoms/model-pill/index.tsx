import type React from "react";
import { cn } from "../../lib/cn";

/** Line heights of the label. */
export enum ModelPillSize {
  Small = 24,
  Medium = 28,
}

interface ModelPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: ModelPillSize;
  /** The model's name. */
  children: React.ReactNode;
}

// `.code` sets its own line height outside the utility layer.
const sizeText = {
  [ModelPillSize.Medium]: "text-base !leading-7",
  [ModelPillSize.Small]: "text-sm !leading-6",
} satisfies Record<ModelPillSize, string>;

/** The model behind a reply, as the mono label that heads it. */
const ModelPill: React.FC<ModelPillProps> & { Size: typeof ModelPillSize } = ({
  size = ModelPillSize.Medium,
  className = "",
  children,
  ...props
}) => (
  <span
    className={cn(
      "code min-w-0 truncate font-medium text-basic-primary",
      sizeText[size],
      className,
    )}
    {...props}
  >
    {children}
  </span>
);

ModelPill.Size = ModelPillSize;

export default ModelPill;
