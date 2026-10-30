import type React from "react";
import Icon, { IconName } from "../icon";
import { cn } from "../../lib/cn";

/** Pixel sizes from the Figma Loader component (xs through 4xl). */
export enum LoaderSize {
  XSmall = 16,
  Small = 20,
  Medium = 24,
  MediumLarge = 28,
  Large = 32,
  X2Large = 36,
  X3Large = 40,
  XLarge = 48,
}

/** CSS color for the spinning glyph, which draws with currentColor. */
export enum LoaderVariant {
  Brand = "var(--color-fill-accent-primary)",
  Neutral = "var(--color-fill-basic-primary)",
  Destructive = "var(--color-fill-error-primary)",
  OnPrimary = "var(--color-fill-btn-primary)",
}

interface LoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: LoaderSize;
  variant?: LoaderVariant;
}

const Loader: React.FC<LoaderProps> & {
  Size: typeof LoaderSize;
  Variant: typeof LoaderVariant;
} = ({ size = LoaderSize.XLarge, variant = LoaderVariant.Neutral, className = "", ...props }) => (
  <div className={cn("loader flex size-fit", className)} {...props}>
    <Icon iconName={IconName.Loader} size={size} color={variant} />
  </div>
);

Loader.Size = LoaderSize;
Loader.Variant = LoaderVariant;

export default Loader;
