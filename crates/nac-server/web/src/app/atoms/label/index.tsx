import type React from "react";
import { cn } from "../../lib/cn";
import HoverHint, { HoverHintSize } from "../hover-hint";
import Icon, { IconName } from "../icon";

export enum LabelSize {
  Micro = "label-micro",
  Small = "label-small",
  Medium = "label-medium",
}

export interface HoverHintConfig {
  title: string;
  description?: string;
}

const iconSizeFor = {
  [LabelSize.Micro]: 16,
  [LabelSize.Small]: 20,
  [LabelSize.Medium]: 24,
} satisfies Record<LabelSize, number>;

const hintSizeFor = {
  [LabelSize.Micro]: HoverHintSize.Small,
  [LabelSize.Small]: HoverHintSize.Small,
  [LabelSize.Medium]: HoverHintSize.Medium,
} satisfies Record<LabelSize, HoverHintSize>;

interface LabelProps {
  children: React.ReactNode;
  htmlFor?: string;
  size?: LabelSize;
  icon?: IconName;
  /** Renders in the error colour, to match a field failing validation. */
  validation?: boolean;
  tone?: "primary" | "secondary" | "muted";
  hoverHint?: HoverHintConfig;
  className?: string;
}

/** Field caption with an optional leading glyph and an explanatory hint. */
const Label: React.FC<LabelProps> & { Size: typeof LabelSize } = ({
  children,
  htmlFor,
  size = LabelSize.Small,
  icon,
  validation = false,
  tone = "secondary",
  hoverHint,
  className = "",
}) => (
  <label
    htmlFor={htmlFor}
    className={cn(
      "flex items-center gap-1.5 min-w-0",
      size,
      validation
        ? "text-error-primary"
        : tone === "primary"
          ? "text-basic-primary"
          : tone === "muted"
            ? "text-basic-muted"
            : "text-basic-secondary",
      className,
    )}
  >
    {icon ? (
      <Icon iconName={icon} size={iconSizeFor[size]} className="shrink-0" />
    ) : null}
    <span className="truncate">{children}</span>
    {hoverHint ? (
      <HoverHint
        title={hoverHint.title}
        description={hoverHint.description}
        size={hintSizeFor[size]}
      />
    ) : null}
  </label>
);

Label.Size = LabelSize;

export default Label;
