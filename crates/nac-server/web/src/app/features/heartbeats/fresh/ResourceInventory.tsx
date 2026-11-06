import { useState } from "react";
import { Button } from "@/app/atoms";
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
    <div className="flex flex-col gap-4">
      {count === 0 && <p>No task has been prepared yet.</p>}
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
        <nav aria-label="Retained task inventory pages" className="flex items-center gap-3">
          <Button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Newer tasks
          </Button>
          <p role="status">
            {start + 1}–{Math.min(start + pageSize, count)} of {count} retained resources
          </p>
          <Button disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}>
            Older tasks
          </Button>
        </nav>
      )}
    </div>
  );
}
