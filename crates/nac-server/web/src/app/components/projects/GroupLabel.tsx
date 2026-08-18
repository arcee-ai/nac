import { Separator } from "@/app/atoms";

/**
 * Heading for a group of rows, in the form the model catalog uses: the name,
 * then a rule filling whatever the name leaves of the line.
 */
export function GroupLabel({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-3 pb-1 first:pt-1">
      <span className="tag-label text-basic-muted whitespace-nowrap shrink-0">{children}</span>
      {/* Basis 100%, so it eats the row's slack and leaves the label at its
          natural width. */}
      <Separator className="shrink" />
    </div>
  );
}
