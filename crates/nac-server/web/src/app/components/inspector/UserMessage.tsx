import { cn } from "@/app/lib/cn";

/** The prompt bubble. Pending ones are dimmed until the snapshot catches up. */
export function UserMessage({
  text,
  pending = false,
}: {
  text: string;
  pending?: boolean;
}) {
  return (
    <div
      className={cn(
        "p-5 rounded-[8px] bg-elevation-sublevel-variant-B shadow-convex",
        "paragraph-medium text-basic-primary whitespace-pre-wrap break-words",
        pending && "opacity-60",
      )}
    >
      {text}
    </div>
  );
}
