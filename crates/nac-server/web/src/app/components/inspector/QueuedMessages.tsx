import { Fragment, useEffect, useState } from "react";

import { QueuedItem, type QueueDropEdge } from "@/app/components/inspector/QueuedItem";
import type { InboxItem } from "@/app/types/api";

type QueuedMessagesProps = {
  items: InboxItem[];
  disabled?: boolean;
  onSteer: (item: InboxItem) => void;
  onDelete: (item: InboxItem) => void;
  onSavePrompt: (item: InboxItem, prompt: string) => Promise<void> | void;
  onReorder: (itemIds: number[]) => void;
};

function moveItem(ids: number[], from: number, to: number): number[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) {
    return ids;
  }
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function dropIndex(targetIndex: number, edge: QueueDropEdge, fromIndex: number): number {
  const raw = edge === "before" ? targetIndex : targetIndex + 1;
  return raw > fromIndex ? raw - 1 : raw;
}

export function QueuedMessages({
  items,
  disabled = false,
  onSteer,
  onDelete,
  onSavePrompt,
  onReorder,
}: QueuedMessagesProps) {
  const [ordered, setOrdered] = useState(items);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<{ id: number; edge: QueueDropEdge } | null>(null);

  useEffect(() => {
    setOrdered(items);
  }, [items]);

  const endDrag = () => {
    setDraggingId(null);
    setDropAt(null);
  };

  const dropOn = (targetId: number, edge: QueueDropEdge) => {
    if (draggingId == null || draggingId === targetId) {
      endDrag();
      return;
    }
    const ids = ordered.map((item) => item.id);
    const from = ids.indexOf(draggingId);
    const target = ids.indexOf(targetId);
    const nextIds = moveItem(ids, from, dropIndex(target, edge, from));
    endDrag();
    if (nextIds.every((id, index) => id === ids[index])) return;
    setOrdered(
      nextIds
        .map((id) => ordered.find((item) => item.id === id))
        .filter((item): item is InboxItem => item != null),
    );
    onReorder(nextIds);
  };

  if (ordered.length === 0) return null;

  return (
    <section
      aria-label={`Queued (${ordered.length})`}
      className="relative flex w-full flex-col overflow-clip rounded-[8px] bg-elevation-level-2 shadow-2xl"
    >
      <div className="flex w-full items-center border-b border-muted px-2 py-1">
        <p className="min-w-0 flex-1 truncate tag-label text-basic-primary">
          Queued ({ordered.length})
        </p>
      </div>
      <div className="flex max-h-[144px] w-full flex-col overflow-x-clip overflow-y-auto">
        <div className="flex w-full flex-col gap-1 p-2 [&>*]:shrink-0">
          {ordered.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 ? <div className="h-px w-full bg-divider-tertiary" /> : null}
              <QueuedItem
                item={item}
                disabled={disabled}
                dragging={draggingId === item.id}
                dropEdge={dropAt?.id === item.id && draggingId !== item.id ? dropAt.edge : null}
                onDragStart={setDraggingId}
                onDragOver={(id, edge) => {
                  if (!draggingId) return;
                  setDropAt((current) =>
                    current?.id === id && current.edge === edge ? current : { id, edge },
                  );
                }}
                onDrop={dropOn}
                onDragEnd={endDrag}
                onSteer={onSteer}
                onDelete={onDelete}
                onSavePrompt={onSavePrompt}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}
