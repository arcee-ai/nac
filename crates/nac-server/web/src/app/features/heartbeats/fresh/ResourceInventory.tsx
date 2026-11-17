import { useState } from "react";
import { Button, ButtonSize, ButtonVariant } from "@/app/atoms";
import type { FreshTaskScheduleInspection } from "@/app/types/api";
import { ResourceCard } from "./ResourceCard";

const pageSize = 10;

export function ResourceInventory({
  inspection,
  presentSessionIds,
}: {
  inspection: FreshTaskScheduleInspection;
  presentSessionIds: ReadonlySet<string> | undefined;
}) {
  const [page, setPage] = useState(0);
  const count = inspection.inventory.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const current = Math.min(page, pages - 1);
  const start = current * pageSize;
  // Newest first keeps partial preparations and current runs on the first
  // page. Only visible resources mount passive initial-input queries.
  const resources = inspection.inventory
    .slice()
    .reverse()
    .slice(start, start + pageSize);
  return (
    <div className="flex flex-col gap-3">
      {count === 0 && (
        <p className="type-body-chrome rounded-card border border-dashed border-tertiary px-4 py-6 text-basic-tertiary">
          No task has been prepared yet.
        </p>
      )}
      {resources.map((receipt) => (
        <ResourceCard
          key={receipt.occurrence_id}
          receipt={receipt}
          launch={inspection.launches.find(
            (launch) => launch.request.request_id === receipt.request.request_id,
          )}
          present={presentSessionIds?.has(receipt.session_id)}
        />
      ))}
      {pages > 1 && (
        <nav
          aria-label="Retained task inventory pages"
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Small}
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Newer tasks
          </Button>
          <p role="status" className="type-meta tabular text-basic-tertiary">
            {start + 1}–{Math.min(start + pageSize, count)} of {count} retained resources
          </p>
          <Button
            variant={ButtonVariant.Secondary}
            size={ButtonSize.Small}
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Older tasks
          </Button>
        </nav>
      )}
    </div>
  );
}
