import { useEffect, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
} from "@/app/atoms";
import { isAgentBehavior } from "@/app/lib/sessionBehavior";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { toRunError } from "@/app/lib/providerError";
import { api } from "@/app/services/api";
import {
  queryKeys,
  useDeletePermissionGrant,
  useReplyPermission,
  useSessionPermissions,
  useTraditionalChildren,
} from "@/app/services/queries";
import type {
  PermissionGrantRecord,
  PermissionReply,
  PermissionRequest,
  PermissionStateResponse,
  SessionBehavior,
} from "@/app/types/api";

interface PermissionPanelProps {
  sessionId: string;
  behavior: SessionBehavior | null | undefined;
  heading?: string;
}

export interface PendingPermissionAsk {
  sessionId: string;
  sourceLabel: string | null;
  request: PermissionRequest;
}

function requestIdentity(requests: PermissionRequest[]): string {
  return requests.map((request) => request.id).join(":");
}

function GrantRow({
  grant,
  deleting,
  onDelete,
}: {
  grant: PermissionGrantRecord;
  deleting: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[4px] bg-elevation-level-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="tag-label uppercase text-basic-secondary">
            {grant.action}
          </span>
          <span className="tag-label uppercase text-basic-tertiary">
            {grant.backend}
          </span>
        </div>
        <div className="mt-1 break-all code code-small text-basic-primary">
          {grant.resource}
        </div>
      </div>
      <Button
        size={ButtonSize.Small}
        variant={ButtonVariant.GhostDestructive}
        content={ButtonContent.Icon}
        aria-label={`Forget ${grant.action} permission`}
        loading={deleting}
        onClick={onDelete}
      >
        <Icon iconName={IconName.Trash} size={16} />
      </Button>
    </div>
  );
}

export function PermissionRequestPrompt({
  request,
  extraWaiting,
  sourceLabel,
  compact = false,
  replyingTo,
  replyChoice,
  onReply,
}: {
  request: PermissionRequest;
  extraWaiting: number;
  sourceLabel?: string | null;
  compact?: boolean;
  replyingTo: string | null;
  replyChoice: PermissionReply | undefined;
  onReply: (choice: PermissionReply) => void;
}) {
  const rememberable = request.resources.some(
    (resource) => resource.save_resource,
  );
  return (
    <div aria-label="Requested access">
      {sourceLabel ? (
        <div className="mb-2 text-small text-basic-secondary">
          From {sourceLabel}
        </div>
      ) : null}
      <div className="mb-2 tag-label uppercase text-basic-tertiary">
        Requested access
      </div>
      <div className="flex flex-col gap-2">
        {request.resources.map((resource, index) => (
          <div
            key={`${resource.action}:${resource.resource}:${index}`}
            className="rounded-[4px] bg-elevation-level-2 px-3 py-2"
          >
            <div className="tag-label uppercase text-basic-secondary">
              {resource.action}
            </div>
            <div className="mt-1 break-words text-small text-basic-primary">
              {resource.display}
            </div>
            {resource.save_resource && !compact ? (
              <div className="mt-2 break-all code code-small text-basic-tertiary">
                Always: {resource.save_resource}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {extraWaiting > 0 ? (
        <div className="mt-2 text-small text-basic-secondary">
          {extraWaiting} more request{extraWaiting === 1 ? "" : "s"} waiting.
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          variant={ButtonVariant.SecondaryDestructive}
          loading={replyingTo === request.id && replyChoice === "reject"}
          disabled={replyingTo !== null}
          onClick={() => onReply("reject")}
        >
          Reject
        </Button>
        <Button
          variant={ButtonVariant.Secondary}
          loading={replyingTo === request.id && replyChoice === "once"}
          disabled={replyingTo !== null}
          onClick={() => onReply("once")}
        >
          Allow once
        </Button>
        <Button
          variant={ButtonVariant.Primary}
          loading={replyingTo === request.id && replyChoice === "always"}
          disabled={replyingTo !== null || !rememberable}
          title={
            rememberable
              ? "Remember the server-derived narrow access pattern"
              : "This operation has no safe reusable permission pattern"
          }
          onClick={() => onReply("always")}
        >
          Always allow
        </Button>
      </div>
    </div>
  );
}

export function usePermissionAsks(
  sessionId: string,
  behavior: SessionBehavior | null,
) {
  const direct = isAgentBehavior(behavior);
  const childrenQuery = useTraditionalChildren(sessionId, direct);
  const runningChildren = (childrenQuery.data ?? []).filter(
    (child) => child.status === "running",
  );
  const watchedIds = direct
    ? [sessionId, ...runningChildren.map((child) => child.child_session_id)]
    : [];
  const queries = useQueries({
    queries: watchedIds.map((id) => ({
      queryKey: queryKeys.sessionPermissions(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        api.getPermissions(id, signal),
      enabled: direct,
      staleTime: Infinity,
      retry: false,
    })),
  });
  const asks: PendingPermissionAsk[] = [];
  if (direct) {
    const parentRequests =
      (queries[0]?.data as PermissionStateResponse | undefined)?.requests ?? [];
    for (const request of parentRequests) {
      asks.push({ sessionId, sourceLabel: null, request });
    }
    runningChildren.forEach((child, index) => {
      const childRequests =
        (queries[index + 1]?.data as PermissionStateResponse | undefined)
          ?.requests ?? [];
      for (const request of childRequests) {
        asks.push({
          sessionId: child.child_session_id,
          sourceLabel: child.description,
          request,
        });
      }
    });
  }
  return {
    direct,
    asks,
    identity: requestIdentity(asks.map((ask) => ask.request)),
    pending: asks.length > 0,
    ready:
      !direct ||
      ((!childrenQuery.isPending || childrenQuery.isFetched) &&
        queries.every((query) => !query.isPending)),
  };
}

/** Direct-session permission prompt and remembered-grant manager for session settings. */
export function PermissionPanel({
  sessionId,
  behavior,
  heading = "Permissions",
}: PermissionPanelProps) {
  const direct = isAgentBehavior(behavior);
  const permissions = useSessionPermissions(sessionId, direct);
  const replyPermission = useReplyPermission();
  const deleteGrant = useDeletePermissionGrant();
  const toast = useToast();
  const requests = permissions.data?.requests ?? [];
  const grants = permissions.data?.grants ?? [];
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [deletingGrant, setDeletingGrant] = useState<string | null>(null);

  if (!direct) return null;

  const active = requests[0] ?? null;

  const reply = async (choice: PermissionReply) => {
    if (!active || replyingTo) return;
    setReplyingTo(active.id);
    try {
      await replyPermission.mutateAsync({
        sessionId,
        requestId: active.id,
        reply: choice,
      });
    } catch (error) {
      toast.error(
        `Unable to answer permission request: ${errorMessage(toRunError(error))}`,
      );
    } finally {
      setReplyingTo(null);
    }
  };

  const forget = async (grant: PermissionGrantRecord) => {
    if (deletingGrant) return;
    setDeletingGrant(grant.id);
    try {
      await deleteGrant.mutateAsync({ sessionId, grantId: grant.id });
    } catch (error) {
      toast.error(
        `Unable to forget permission: ${errorMessage(toRunError(error))}`,
      );
    } finally {
      setDeletingGrant(null);
    }
  };

  return (
    <section className="flex flex-col gap-4" aria-label={heading}>
      <div>
        <div className="label-small text-basic-primary">{heading}</div>
        <p className="mt-1 text-micro text-basic-muted">
          {active
            ? `${active.tool} is paused before execution.`
            : "Remembered access for this session. A paused tool waits here."}
        </p>
      </div>

      {permissions.isPending ? (
        <div className="py-4 text-center text-small text-basic-secondary">
          Loading permissions…
        </div>
      ) : permissions.isError ? (
        <div className="rounded-[4px] bg-error-secondary p-3 text-small text-error-primary">
          Permissions could not be loaded. The run remains fail-closed.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {active ? (
            <PermissionRequestPrompt
              request={active}
              extraWaiting={requests.length - 1}
              replyingTo={replyingTo}
              replyChoice={replyPermission.variables?.reply}
              onReply={(choice) => void reply(choice)}
            />
          ) : null}

          <div aria-label="Remembered permissions">
            <div className="mb-2 tag-label uppercase text-basic-tertiary">
              Remembered for this session
            </div>
            {grants.length ? (
              <div className="flex flex-col gap-2">
                {grants.map((grant) => (
                  <GrantRow
                    key={grant.id}
                    grant={grant}
                    deleting={deletingGrant === grant.id}
                    onDelete={() => void forget(grant)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-small text-basic-secondary">
                No remembered permissions.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Opens the compact permission prompt when a new ask arrives, including asks
 * from running child agents that surface on the parent chat. Session settings
 * stay closed unless the user opens them.
 */
export function PermissionSettingsOpener({
  sessionId,
  behavior,
  onAsk,
}: {
  sessionId: string;
  behavior: SessionBehavior | null;
  onAsk?: () => void;
}) {
  const { direct, identity } = usePermissionAsks(sessionId, behavior);
  const opened = useRef("");

  useEffect(() => {
    if (!direct || !identity || identity === opened.current) return;
    opened.current = identity;
    onAsk?.();
  }, [direct, identity, onAsk]);

  return null;
}

export function usePermissionAskPending(
  sessionId: string,
  behavior: SessionBehavior | null,
): boolean {
  return usePermissionAsks(sessionId, behavior).pending;
}
