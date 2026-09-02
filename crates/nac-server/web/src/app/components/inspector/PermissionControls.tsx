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
import { useSessionActions } from "@/app/providers/SessionActionsProvider";
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
          <span className="tag-label uppercase text-basic-secondary">{grant.action}</span>
          <span className="tag-label uppercase text-basic-tertiary">{grant.backend}</span>
        </div>
        <div className="mt-1 break-all code code-small text-basic-primary">{grant.resource}</div>
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

function usePermissionAskIdentity(sessionId: string, behavior: SessionBehavior | null) {
  const direct = isAgentBehavior(behavior);
  const childrenQuery = useTraditionalChildren(sessionId, direct);
  const childIds = (childrenQuery.data ?? [])
    .filter((child) => child.status === "running")
    .map((child) => child.child_session_id);
  const watchedIds = direct ? [sessionId, ...childIds] : [];
  const queries = useQueries({
    queries: watchedIds.map((id) => ({
      queryKey: queryKeys.sessionPermissions(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) => api.getPermissions(id, signal),
      enabled: direct,
      staleTime: Infinity,
      retry: false,
    })),
  });
  const requests = queries.flatMap(
    (query) => (query.data as PermissionStateResponse | undefined)?.requests ?? [],
  );
  return { direct, identity: requestIdentity(requests), pending: requests.length > 0 };
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
  const rememberable = active?.resources.some((resource) => resource.save_resource) ?? false;

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
      toast.error(`Unable to answer permission request: ${errorMessage(toRunError(error))}`);
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
      toast.error(`Unable to forget permission: ${errorMessage(toRunError(error))}`);
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
        <div className="py-4 text-center text-small text-basic-secondary">Loading permissions…</div>
      ) : permissions.isError ? (
        <div className="rounded-[4px] bg-error-secondary p-3 text-small text-error-primary">
          Permissions could not be loaded. The run remains fail-closed.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {active ? (
            <div aria-label="Requested access">
              <div className="mb-2 tag-label uppercase text-basic-tertiary">Requested access</div>
              <div className="flex flex-col gap-2">
                {active.resources.map((resource, index) => (
                  <div
                    key={`${resource.action}:${resource.resource}:${index}`}
                    className="rounded-[4px] bg-elevation-level-2 px-3 py-2"
                  >
                    <div className="tag-label uppercase text-basic-secondary">{resource.action}</div>
                    <div className="mt-1 break-words text-small text-basic-primary">
                      {resource.display}
                    </div>
                    {resource.save_resource ? (
                      <div className="mt-2 break-all code code-small text-basic-tertiary">
                        Always: {resource.save_resource}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
              {requests.length > 1 ? (
                <div className="mt-2 text-small text-basic-secondary">
                  {requests.length - 1} more request{requests.length === 2 ? "" : "s"} waiting.
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  variant={ButtonVariant.SecondaryDestructive}
                  loading={replyingTo === active.id && replyPermission.variables?.reply === "reject"}
                  disabled={replyingTo !== null}
                  onClick={() => void reply("reject")}
                >
                  Reject
                </Button>
                <Button
                  variant={ButtonVariant.Secondary}
                  loading={replyingTo === active.id && replyPermission.variables?.reply === "once"}
                  disabled={replyingTo !== null}
                  onClick={() => void reply("once")}
                >
                  Allow once
                </Button>
                <Button
                  variant={ButtonVariant.Primary}
                  loading={
                    replyingTo === active.id && replyPermission.variables?.reply === "always"
                  }
                  disabled={replyingTo !== null || !rememberable}
                  title={
                    rememberable
                      ? "Remember the server-derived narrow access pattern"
                      : "This operation has no safe reusable permission pattern"
                  }
                  onClick={() => void reply("always")}
                >
                  Always allow
                </Button>
              </div>
            </div>
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
              <div className="text-small text-basic-secondary">No remembered permissions.</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Opens session settings when a new permission ask arrives, including asks
 * from running child agents that surface on the parent chat.
 */
export function PermissionSettingsOpener({
  sessionId,
  behavior,
}: {
  sessionId: string;
  behavior: SessionBehavior | null;
}) {
  const actions = useSessionActions();
  const { direct, identity } = usePermissionAskIdentity(sessionId, behavior);
  const opened = useRef("");

  useEffect(() => {
    if (!direct || !identity || identity === opened.current) return;
    opened.current = identity;
    actions.settings(sessionId);
  }, [actions, direct, identity, sessionId]);

  return null;
}

export function usePermissionAskPending(
  sessionId: string,
  behavior: SessionBehavior | null,
): boolean {
  return usePermissionAskIdentity(sessionId, behavior).pending;
}
