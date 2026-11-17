import type React from "react";

import { cn } from "@/app/lib/cn";
import Icon, { type IconName } from "../icon";

interface InitialPromptBoxProps {
  icon: IconName;
  title: string;
  /** The prompt itself, clamped to the two lines the box has room for. */
  description: string;
  onClick: () => void;
  className?: string;
}

/**
 * Card offering one ready-made prompt: a hairline card whose hover and press
 * washes sit on a layer above its surface, so both read in light and dark.
 */
const InitialPromptBox: React.FC<InitialPromptBoxProps> = ({
  icon,
  title,
  description,
  onClick,
  className = "",
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "group relative flex min-h-[88px] w-full flex-col items-start gap-1 overflow-hidden px-4 py-3.5",
      "rounded-card border border-tertiary bg-elevation-level-1 text-left",
      "transition-colors duration-150 ease-out hover:border-secondary motion-reduce:transition-none",
      "outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus-outline)]",
      className,
    )}
  >
    <span
      aria-hidden
      className="absolute inset-0 bg-transparent transition-colors duration-150 ease-out group-hover:bg-[var(--f-wash-1)] group-active:bg-[var(--f-wash-2)]"
    />
    <span className="relative flex w-full items-center gap-2">
      <Icon iconName={icon} size={16} className="shrink-0 text-fill-basic-tertiary" />
      <span className="min-w-0 flex-1 truncate type-label text-basic-primary">{title}</span>
    </span>
    <span className="relative line-clamp-2 w-full type-meta text-basic-tertiary">
      {description}
    </span>
  </button>
);

export default InitialPromptBox;
