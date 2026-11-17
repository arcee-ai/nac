import { createContext, useContext } from "react";

import { routes } from "@/app/lib/routes";
import type { FleetAttentionStatus } from "@/app/services/queries";
import type { FleetAttentionSession } from "@/app/types/api";

import type { InboxModel, InboxRow, InboxTarget } from "./inboxModel";

export interface InboxContextValue {
  model: InboxModel;
  /** The attention feed itself: "unavailable" means nothing below can be trusted. */
  status: FleetAttentionStatus;
  /** Raw fleet facts per session, for read marks and the status ladder. */
  attention: ReadonlyMap<string, FleetAttentionSession>;
  lastOutcomeRun: (sessionId: string) => string | null;
  open: (row: InboxRow) => void;
  openNext: () => void;
  markAllRead: () => void;
  markRead: (sessionId: string, runId: string) => void;
}

export const EMPTY_INBOX: InboxModel = {
  needsYou: [],
  failed: [],
  done: [],
  unavailable: [],
  badge: 0,
};

export const InboxContext = createContext<InboxContextValue | null>(null);

const FALLBACK: InboxContextValue = {
  model: EMPTY_INBOX,
  status: "unavailable",
  attention: new Map(),
  lastOutcomeRun: () => null,
  open: () => {},
  openNext: () => {},
  markAllRead: () => {},
  markRead: () => {},
};

/** The Inbox; outside the provider (isolated component tests) it is honestly unavailable. */
export function useInbox(): InboxContextValue {
  return useContext(InboxContext) ?? FALLBACK;
}

/** The session route for a row, at the exact request when there is one. */
export function inboxHref(target: InboxTarget): string {
  const base = routes.session(target.sessionId);
  const params = new URLSearchParams();
  if (target.permissionRequestId) params.set("permission_request", target.permissionRequestId);
  if (target.questionRequestId) params.set("question_request", target.questionRequestId);
  if (target.reviewId) params.set("review_request", target.reviewId);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
