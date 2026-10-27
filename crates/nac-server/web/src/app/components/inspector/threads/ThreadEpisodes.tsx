import { useState } from "react";

import { Badge, BadgeColor, DropdownContent, Icon, IconName, Separator } from "@/app/atoms";
import { useIsMobile } from "@/app/hooks/useMediaQuery";
import { cn } from "@/app/lib/cn";
import { Markdown } from "@/app/lib/markdown";

import type { EpisodeSnapshot } from "@/app/types/api";

/** How a dispatch that produced no handoff ended, as the badge reads it. */
interface FailedEpisodeBadgeMap {
  [reason: string]: { label: string; color: BadgeColor };
}

const FAILED_EPISODE_BADGE: FailedEpisodeBadgeMap = {
  error: { label: "Failed", color: BadgeColor.Red },
  timed_out: { label: "Timed out", color: BadgeColor.Yellow },
  cancelled: { label: "Cancelled", color: BadgeColor.Yellow },
};

/**
 * One dispatch as a collapsible tab. The row carries the index and how the
 * dispatch ended; expanding it reveals only what the thread handed back, since
 * the prompt is already one click away under the panel's own Task control.
 * Each tab owns its open state so several can be read at once.
 */
function EpisodeTab({ episode, index }: { episode: EpisodeSnapshot; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const isMobile = useIsMobile();
  const failure = FAILED_EPISODE_BADGE[episode.status];
  const labelClass = isMobile ? "label-small" : "label-micro";
  return (
    <div className="flex flex-col items-start w-full">
      <button
        type="button"
        className="group flex items-center gap-2 w-full py-3 pl-1 pr-3 md:py-2 md:pl-3 md:pr-2 rounded-[4px] btn-ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon
          iconName={expanded ? IconName.Down : IconName.Right}
          size={16}
          className="shrink-0 text-basic-muted"
        />
        <span className={`shrink-0 ${labelClass} text-basic-primary`}>
          {`Episode ${index + 1}`}
        </span>
        {failure ? <Badge text={failure.label} color={failure.color} className="shrink-0" /> : null}
      </button>
      <DropdownContent isOpen={expanded} className="w-full">
        <div className="flex flex-col pl-1 pr-1 md:pl-3 md:pr-2 pt-2 pb-6">
          {episode.content.trim() ? (
            <Markdown className="text-basic-primary">{episode.content}</Markdown>
          ) : (
            <p className="label-small text-basic-muted">
              {failure
                ? "The dispatch ended before the thread answered."
                : "The thread answered with nothing."}
            </p>
          )}
        </div>
      </DropdownContent>
    </div>
  );
}

/** The dispatches of one thread as collapsible tabs. */
export function Episodes({
  episodes,
  running,
  className,
}: {
  episodes: EpisodeSnapshot[];
  running: boolean;
  className?: string;
}) {
  if (!episodes.length) {
    return (
      <div className={cn("flex flex-1 min-h-0", className)}>
        <p className="p-4 max-w-prose label-small text-basic-muted">
          {running
            ? "An episode records one dispatch — what the thread was asked to do and what came back. This one is written when the dispatch ends; until then Logs is the live view."
            : "This thread has not been dispatched yet, so it has no episodes."}
        </p>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", className)}>
      <div className="pb-[128px] md:pb-4 flex flex-col">
        {episodes.map((episode, index) => (
          <div key={episode.id} className="flex flex-col">
            {index > 0 ? <Separator /> : null}
            <EpisodeTab episode={episode} index={index} />
          </div>
        ))}
      </div>
    </div>
  );
}
