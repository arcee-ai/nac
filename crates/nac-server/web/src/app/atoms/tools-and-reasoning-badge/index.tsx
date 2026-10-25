import type React from "react";
import { useRef } from "react";

import { useTimelinePhase } from "../../lib/animationPhase";
import { cn } from "../../lib/cn";
import Icon, { IconName } from "../icon";
import ModelLoader, { ModelLoaderSize, ModelLoaderVariant } from "../model-loader";

interface ToolsAndReasoningBadgeProps {
  /** "Total activity: 12.3s" once done, or the live step, e.g. "Reading index.tsx…". */
  label: string;
  /** Leads with a ModelLoader. A finished group trails a chevron instead. */
  inProgress: boolean;
  /** The group is open in Insights. It says nothing about the group running. */
  selected?: boolean;
  /** Image in the round plate after the label, such as a site's favicon. */
  avatarUrl?: string | null;
  /** Glyph in the same plate when there is no `avatarUrl`. */
  leadingIcon?: IconName;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Id of the Insights panel the badge opens. */
  controls?: string;
  className?: string;
}

/** Rest tone, then the hovered, pressed and disabled steps. */
const LABEL_TONE = {
  done: "text-basic-tertiary hover:text-basic-secondary active:text-basic-primary disabled:text-basic-muted",
  live: "text-basic-primary hover:text-basic-secondary active:text-basic-primary disabled:text-basic-muted",
  selected:
    "text-accent-primary hover:text-accent-secondary active:text-accent-tertiary disabled:text-accent-muted",
};

/** Glyph paths carry `fill="currentColor"`, so the fill tokens go on the paths. */
const ICON_TONE = {
  basic:
    "[&>path]:fill-basic-tertiary group-hover:[&>path]:fill-basic-secondary group-active:[&>path]:fill-basic-primary group-disabled:[&>path]:fill-basic-muted",
  selected:
    "[&>path]:fill-accent-primary group-hover:[&>path]:fill-accent-secondary group-active:[&>path]:fill-accent-tertiary group-disabled:[&>path]:fill-accent-muted",
};

/** Hover, press, disabled and reduced motion stop the shimmer on the plain tone. */
const SHIMMER = [
  "text-shimmer-basic",
  "group-hover:animate-none group-hover:bg-none group-hover:text-inherit group-hover:[-webkit-text-fill-color:currentColor]",
  "group-active:animate-none group-active:bg-none group-active:text-inherit group-active:[-webkit-text-fill-color:currentColor]",
  "group-disabled:animate-none group-disabled:bg-none group-disabled:text-inherit group-disabled:[-webkit-text-fill-color:currentColor]",
  "motion-reduce:animate-none motion-reduce:bg-none motion-reduce:text-inherit motion-reduce:[-webkit-text-fill-color:currentColor]",
].join(" ");

/**
 * Stands in the transcript for one group of reasoning and tool calls. While
 * the group runs it shows the live step after a ModelLoader; once done it
 * shows how long the work took and a chevron into Insights.
 *
 * The live label changes on every step, so the badge is deliberately not a
 * live region.
 */
const ToolsAndReasoningBadge: React.FC<ToolsAndReasoningBadgeProps> = ({
  label,
  inProgress,
  selected = false,
  avatarUrl,
  leadingIcon,
  disabled = false,
  onClick,
  controls,
  className = "",
}) => {
  const labelTone = selected ? LABEL_TONE.selected : inProgress ? LABEL_TONE.live : LABEL_TONE.done;
  const iconTone = selected ? ICON_TONE.selected : ICON_TONE.basic;
  const shimmering = inProgress && !selected;
  const labelRef = useRef<HTMLSpanElement>(null);
  useTimelinePhase(labelRef, shimmering);

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-controls={controls}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group relative inline-flex max-w-full items-center gap-2 border-l-2 pl-4 transition-colors",
        "focus-visible:outline-none disabled:cursor-not-allowed",
        selected ? "border-primary" : "border-muted",
        labelTone,
        className,
      )}
    >
      {/* Offsets start inside the 2px left border, hence the longer left one. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-1 -right-1 -bottom-1 -left-1.5 hidden rounded-[4px] border-2 border-[var(--color-border-focus-outline)] group-focus-visible:block"
      />
      {inProgress ? (
        <ModelLoader
          size={ModelLoaderSize.Medium}
          variant={selected ? ModelLoaderVariant.Accent : ModelLoaderVariant.Default}
          className="group-disabled:opacity-50"
        />
      ) : null}
      <span ref={labelRef} className={cn("label-small min-w-0 truncate", shimmering && SHIMMER)}>
        {label}
      </span>
      {avatarUrl || leadingIcon ? (
        <span
          aria-hidden="true"
          className="flex size-[20px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-tertiary bg-elevation-level-3 p-px"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="block size-full rounded-full object-cover" />
          ) : leadingIcon ? (
            <Icon iconName={leadingIcon} size={16} className={iconTone} />
          ) : null}
        </span>
      ) : null}
      {inProgress ? null : (
        <Icon
          iconName={IconName.Right}
          size={20}
          aria-hidden
          className={cn("shrink-0", iconTone)}
        />
      )}
    </button>
  );
};

export default ToolsAndReasoningBadge;
