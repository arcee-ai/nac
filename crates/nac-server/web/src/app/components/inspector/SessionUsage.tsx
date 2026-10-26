import { Fragment, useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
  PopoverSize,
} from "@/app/atoms";
import { useNow } from "@/app/hooks/useNow";
import { formatClock } from "@/app/lib/format";

/**
 * The session header's Usage button and the token, cost and time readings it
 * opens. The run clock lives here rather than in the header, so a running
 * session re-renders this button every second instead of the whole bar.
 */
export function SessionUsage({
  context,
  contextShare,
  input,
  output,
  cost,
  running,
  startedAt,
  lastElapsedMs,
}: {
  context: string;
  /** How much of the model's window the context fills, when that is known. */
  contextShare: string | null;
  input: string;
  output: string;
  cost: string;
  running: boolean;
  startedAt: number | null;
  /** The last finished response, shown while nothing runs. */
  lastElapsedMs: number | null;
}) {
  const [open, setOpen] = useState(false);
  // Ticking for the whole run, not only while open: a clock nobody watched has
  // stopped, and its first reading after a fresh subscription is stale.
  const now = useNow(1000, running);
  const elapsedMs = running && startedAt != null ? Math.max(0, now - startedAt) : lastElapsedMs;
  const readings: [string, string][] = [
    ["Context tokens", context],
    ["Input tokens", input],
    ["Output tokens", output],
    ["Session cost", cost],
    [running ? "Run elapsed" : "Last response time", formatClock(elapsedMs)],
  ];

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      sticky
      placement={PopoverPlacement.BottomLeft}
      size={PopoverSize.Small}
      className="shrink-0"
      content={
        <div className="flex flex-col gap-2 p-1">
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-micro">
            {readings.map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-basic-tertiary">{label}</dt>
                <dd className="text-right text-basic-primary">{value}</dd>
              </Fragment>
            ))}
          </dl>
          {contextShare ? <p className="text-micro text-basic-muted">{contextShare}</p> : null}
        </div>
      }
    >
      <Button
        variant={ButtonVariant.Tertiary}
        size={ButtonSize.Small}
        content={ButtonContent.IconLeft}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon iconName={IconName.Timelaps} size={16} />
        Usage
      </Button>
    </Popover>
  );
}
