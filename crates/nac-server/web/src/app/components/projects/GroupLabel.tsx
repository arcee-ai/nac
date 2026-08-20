import { Separator } from "@/app/atoms";
import { cn } from "@/app/lib/cn";

/**
 * Heading for a group of rows, in the form the model catalog uses: the name,
 * then a rule filling whatever the name leaves of the line, sitting on the
 * name's baseline.
 *
 * Spacing is the caller's, because a heading between rows of a padded list and
 * one between grids of cards sit to different edges.
 */
export function GroupLabel({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <span className="tag-label text-basic-muted whitespace-nowrap shrink-0">{children}</span>
      {/* Basis 100%, so it eats the row's slack and leaves the label at its
          natural width. */}
      <Separator className="shrink" />
    </div>
  );
}
