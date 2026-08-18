import type React from "react";
import Icon, { IconName } from "../icon";
import { cn } from "../../lib/cn";

/** Pixel sizes, mirroring the ArceeFM LoaderSize enum. */
export enum LoaderSize {
  XSmall = 12,
  Micro = 16,
  Small = 20,
  Medium = 24,
  Large = 32,
  XLarge = 48,
}

/** CSS color for the spinning glyph; the icon path renders with currentColor. */
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
} = ({ size = LoaderSize.XLarge, variant = LoaderVariant.Brand, className = "", ...props }) => (
  <div className={cn("flex w-fit h-fit animate-spin loader", className)} {...props}>
    <Icon iconName={IconName.Loader} size={size} color={variant} />
  </div>
);

Loader.Size = LoaderSize;
Loader.Variant = LoaderVariant;

export default Loader;
