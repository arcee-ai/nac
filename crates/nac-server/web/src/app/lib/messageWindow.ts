import type {
  MessagePageMetadata,
  MessagesPageResponse,
  SessionSnapshotResponse,
} from "@/app/types/api";

export const SNAPSHOT_MESSAGE_LIMIT = 24;
export const SNAPSHOT_THREAD_EVENT_LIMIT = 50;

export type MessageWindowMerge =
  | { kind: "accepted"; snapshot: SessionSnapshotResponse }
  | { kind: "snapshot-required" };

function validRange(
  page: MessagePageMetadata,
  messageCount: number,
  createdAtCount: number,
): boolean {
  return (
    Number.isSafeInteger(page.start) &&
    Number.isSafeInteger(page.end) &&
    Number.isSafeInteger(page.total) &&
    page.start >= 0 &&
    page.start <= page.end &&
    page.end <= page.total &&
    page.end - page.start === messageCount &&
    createdAtCount === messageCount
  );
}

export function validMessagesPage(page: MessagesPageResponse): boolean {
  return validRange(page.page, page.messages.length, page.created_at.length);
}
export function validSnapshotWindow(
  snapshot: SessionSnapshotResponse,
): boolean {
  const page = snapshot.message_page;
  const createdAt = snapshot.message_created_at ?? [];
  return Boolean(
    page && validRange(page, snapshot.messages.length, createdAt.length),
  );
}

function snapshotRange(snapshot: SessionSnapshotResponse): MessagePageMetadata {
  return (
    snapshot.message_page ?? {
      start: 0,
      end: snapshot.messages.length,
      total: snapshot.messages.length,
      has_older: false,
    }
  );
}

function snapshotTimes(snapshot: SessionSnapshotResponse): (string | null)[] {
  const times = snapshot.message_created_at ?? [];
  return times.length === snapshot.messages.length
    ? times
    : Array.from({ length: snapshot.messages.length }, () => null);
}


/**
 * Reconcile a newest-tail page into the focused snapshot cache.
 *
 * Previously loaded history is retained only when both ranges belong to the
 * same monotonically growing transcript. A shrink or gap requires a canonical
 * snapshot because a page alone cannot repair the other snapshot projections.
 */
export function mergeMessageTail(
  current: SessionSnapshotResponse,
  incoming: MessagesPageResponse,
): MessageWindowMerge {
  if (!validMessagesPage(incoming)) return { kind: "snapshot-required" };

  const currentPage = snapshotRange(current);
  const currentCreatedAt = snapshotTimes(current);
  if (
    !validRange(currentPage, current.messages.length, currentCreatedAt.length) ||
    incoming.page.end !== incoming.page.total ||
    incoming.page.total < currentPage.total ||
    incoming.page.start > currentPage.end
  ) {
    return { kind: "snapshot-required" };
  }

  if (incoming.page.start <= currentPage.start) {
    return {
      kind: "accepted",
      snapshot: {
        ...current,
        messages: incoming.messages,
        message_created_at: incoming.created_at,
        message_page: incoming.page,
      },
    };
  }

  const prefixLength = incoming.page.start - currentPage.start;
  if (prefixLength > current.messages.length) {
    return { kind: "snapshot-required" };
  }

  return {
    kind: "accepted",
    snapshot: {
      ...current,
      messages: [
        ...current.messages.slice(0, prefixLength),
        ...incoming.messages,
      ],
      message_created_at: [
        ...currentCreatedAt.slice(0, prefixLength),
        ...incoming.created_at,
      ],
      message_page: {
        ...incoming.page,
        start: currentPage.start,
        has_older: currentPage.start > 0,
      },
    },
  };
}

/** Prepend one page only when it still joins the cursor that requested it. */
export function prependMessagePage(
  current: SessionSnapshotResponse,
  incoming: MessagesPageResponse,
  requestedStart: number,
): SessionSnapshotResponse | null {
  if (!validMessagesPage(incoming)) return null;
  const currentPage = snapshotRange(current);
  const currentCreatedAt = snapshotTimes(current);
  if (
    currentPage.start !== requestedStart ||
    incoming.page.end !== requestedStart ||
    incoming.page.total !== currentPage.total ||
    !validRange(currentPage, current.messages.length, currentCreatedAt.length)
  ) {
    return null;
  }

  return {
    ...current,
    messages: [...incoming.messages, ...current.messages],
    message_created_at: [...incoming.created_at, ...currentCreatedAt],
    message_page: {
      start: incoming.page.start,
      end: currentPage.end,
      total: currentPage.total,
      has_older: incoming.page.start > 0,
    },
  };
}

/** Preserve a contiguous loaded prefix when a normal focused snapshot lands. */
export function mergeFocusedSnapshot(
  current: SessionSnapshotResponse | undefined,
  incoming: SessionSnapshotResponse,
  replace: boolean,
): SessionSnapshotResponse {
  if (replace || !current || !incoming.message_page) return incoming;
  if (!validSnapshotWindow(incoming)) return current;
  const createdAt = incoming.message_created_at ?? [];
  const merged = mergeMessageTail(current, {
    messages: incoming.messages,
    created_at: createdAt,
    page: incoming.message_page,
  });
  return merged.kind === "accepted"
    ? {
        ...incoming,
        messages: merged.snapshot.messages,
        message_created_at: merged.snapshot.message_created_at,
        message_page: merged.snapshot.message_page,
      }
    : incoming;
}
