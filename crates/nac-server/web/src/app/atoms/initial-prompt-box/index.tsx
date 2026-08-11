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
 * Card offering one ready-made prompt. The elevation sits on the card while the
 * ghost tokens paint hover and press on a layer above it, which is how the
 * design stacks them — a single background could not carry both.
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
      "group relative flex h-[100px] w-full flex-col items-start overflow-hidden",
      "rounded-[4px] bg-elevation-level-1 text-left shadow-convex",
      "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--blue-500)]",
      className,
    )}
  >
    <span
      aria-hidden
      className="absolute inset-0 bg-btn-ghost transition-colors duration-200 ease-out group-hover:bg-btn-ghost-hovered group-active:bg-btn-ghost-pressed"
    />
    <span className="relative flex w-full items-center gap-[10px] px-4 pb-2 pt-4">
      <Icon
        iconName={icon}
        size={20}
        className="shrink-0 [&>path]:fill-basic-tertiary"
      />
      <span className="flex-1 min-w-0 truncate label-small text-basic-primary">
        {title}
      </span>
    </span>
    <span className="relative flex w-full flex-col justify-end px-4 pb-4 pt-2">
      <span className="text-micro text-basic-muted line-clamp-2">
        {description}
      </span>
    </span>
  </button>
);

export default InitialPromptBox;
