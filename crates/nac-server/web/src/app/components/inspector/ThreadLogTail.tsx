import { useLayoutEffect, useRef } from "react";

import { cn } from "@/app/lib/cn";
import type { ThreadLogLine } from "@/app/lib/threadLog";

/** Height of one log row, which is also how far a new line travels. */
const ROW_HEIGHT = 16;

/** How long a new line takes to rise into place. `duration-150` mirrors it. */
const SLIDE_MS = 150;

/**
 * Rows kept in the DOM. Three sit within the card's log area and the fourth is
 * the one being pushed out of it, which gives the slide something to carry away
 * rather than a line that blinks out.
 */
const WINDOW = 4;

/** Older lines recede rather than compete with the newest one. */
function lineOpacity(distanceFromNewest: number): string {
  switch (distanceFromNewest) {
    case 0:
      return "";
    case 1:
      return "opacity-50";
    case 2:
      return "opacity-10";
    default:
      return "opacity-0";
  }
}

/**
 * Slides the column up by a row whenever a line arrives.
 *
 * The transform is written to the node rather than held in state: the animation
 * has to start from the offset the new line was laid out at, which means the
 * offset must reach the browser's style computation before the transition back
 * to zero is set — and a re-render is too late for that.
 */
function useSlideIn(newestKey: string | undefined) {
  const columnRef = useRef<HTMLDivElement>(null);
  // Seeded with the line already on screen, so mounting a card with a log does
  // not replay an arrival that happened before it was visible.
  const previous = useRef(newestKey);

  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column || newestKey === previous.current) return;
    previous.current = newestKey;
    if (!newestKey) return;

    column.style.transition = "none";
    column.style.transform = `translateY(${ROW_HEIGHT}px)`;
    // Forces the offset to be computed on its own. Without it both writes land
    // in one style pass, the browser only ever sees the resting position, and
    // there is nothing left to animate.
    void column.offsetHeight;
    column.style.transition = `transform ${SLIDE_MS}ms ease-out`;
    column.style.transform = "translateY(0)";
  }, [newestKey]);

  return columnRef;
}

/**
 * The newest lines of a thread's log, bottom-aligned and clipped to whatever
 * height the caller gives it, so the tail reads the way a terminal does: the
 * newest command arrives at the bottom edge and the older ones fade out above.
 */
export function ThreadLogTail({
  lines,
  className,
}: {
  lines: ThreadLogLine[];
  className?: string;
}) {
  const visible = lines.slice(-WINDOW);
  const columnRef = useSlideIn(visible[visible.length - 1]?.key);

  return (
    <div className={cn("flex flex-col justify-end overflow-hidden", className)}>
      <div ref={columnRef} className="flex flex-col">
        {visible.map((line, index) => (
          <span
            key={line.key}
            className={cn(
              "w-full truncate code code-micro !text-[11px] !leading-[16px] !m-0 block",
              // Aging is a fade rather than a step, so a line dims over the same
              // beat as the slide that pushed it up.
              "transition-opacity duration-150 ease-out",
              "text-basic-tertiary",
              lineOpacity(visible.length - 1 - index),
            )}
          >
            {/* A failure is marked by its glyph alone, so the one line the card
                has room for still reads as the command it ran. */}
            {line.isError && line.mark ? (
              <>
                <span className="text-error-primary">{line.mark}</span>{" "}
                {line.body}
              </>
            ) : (
              line.bare
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
