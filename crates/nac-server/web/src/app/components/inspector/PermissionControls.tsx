import { useState } from "react";

import {
  Button,
  ButtonContent,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Modal,
  ModalSize,
  Switch,
  Tooltip,
  TooltipPosition,
} from "@/app/atoms";
import { errorMessage, useToast } from "@/app/providers/ToastProvider";
import { toRunError } from "@/app/lib/providerError";
import {
  useDeletePermissionGrant,
  useReplyPermission,
  useSetPermissionApprovalMode,
  useSessionPermissions,
} from "@/app/services/queries";
import type {
  PermissionGrantRecord,
  PermissionReply,
  PermissionRequest,
  SessionBehavior,
} from "@/app/types/api";

interface PermissionControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
  label?: string;
  autoApprovalAvailable?: boolean;
  requesterLabel?: string;
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

/** Direct-session permission prompt and remembered-grant manager. */
export function PermissionControls({
  sessionId,
  behavior,
  label = "Permissions",
  autoApprovalAvailable = true,
  requesterLabel,
}: PermissionControlsProps) {
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const permissions = useSessionPermissions(sessionId, direct);
  const replyPermission = useReplyPermission();
  const setApprovalMode = useSetPermissionApprovalMode();
  const deleteGrant = useDeletePermissionGrant();
  const toast = useToast();
  const requests = permissions.data?.requests ?? [];
  const grants = permissions.data?.grants ?? [];
  const autoApprove = permissions.data?.approval_mode === "auto_approve";
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [dismissedRequests, setDismissedRequests] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [deletingGrant, setDeletingGrant] = useState<string | null>(null);
  const identity = requestIdentity(requests);
  // Each newly observed ask gets one automatic presentation. Closing the
  // dialog records that exact request set; a later request changes the
  // identity and opens it again without effect-driven state synchronization.
  const open = manuallyOpen || Boolean(identity && identity !== dismissedRequests);
  const close = () => {
    setDismissedRequests(identity);
    setManuallyOpen(false);
  };

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
      if (requests.length === 1) close();
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

  const changeApprovalMode = async (enabled: boolean) => {
    setManuallyOpen(true);
    try {
      await setApprovalMode.mutateAsync({
        sessionId,
        mode: enabled ? "auto_approve" : "manual",
      });
    } catch (error) {
      toast.error(`Unable to change approval mode: ${errorMessage(toRunError(error))}`);
    }
  };

  const badge = requests.length
    ? ` (${requests.length})`
    : grants.length
      ? ` (${grants.length})`
      : "";

  return (
    <>
      <Tooltip title={label} position={TooltipPosition.TopCenter}>
        <Button
          size={ButtonSize.Small}
          variant={
            autoApprove || requests.length
              ? ButtonVariant.GhostHighlightedAccent
              : ButtonVariant.Ghost
          }
          content={autoApprove ? ButtonContent.IconLeft : ButtonContent.Icon}
          aria-label={autoApprove ? "Auto-approve on — open permissions" : `${label}${badge}`}
          onClick={() => setManuallyOpen(true)}
        >
          <Icon iconName={requests.length ? IconName.Important : IconName.Lock} size={16} />
          {autoApprove ? "Auto-approve on" : null}
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onClose={close}
        size={ModalSize.Wide}
        flush
        title={active ? "Permission required" : "Permissions"}
        subheader={
          active
            ? `${active.tool} requested by ${requesterLabel ?? "this session"} is paused before execution.`
            : autoApprove
              ? "Automatic approval is active for this session and its owned child agents."
              : "Remembered access for this session."
        }
        footer={
          active ? (
            <div className="flex w-full flex-wrap justify-end gap-2">
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
                loading={replyingTo === active.id && replyPermission.variables?.reply === "always"}
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
          ) : undefined
        }
      >
        {permissions.isPending ? (
          <div className="py-6 text-center text-small text-basic-secondary">
            Loading permissions…
          </div>
        ) : permissions.isError ? (
          <div className="rounded-[4px] bg-error-secondary p-3 text-small text-error-primary">
            Permissions could not be loaded. The run remains fail-closed.
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {autoApprovalAvailable ? (
              <section
                aria-label="Automatic approval mode"
                className={
                  autoApprove
                    ? "rounded-[6px] border border-accent-primary bg-elevation-level-2 p-3"
                    : "rounded-[6px] bg-elevation-level-2 p-3"
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-small font-medium text-basic-primary">
                      Approve all automatically
                    </div>
                    <div className="mt-1 text-small text-basic-secondary">
                      Automatically allows ordinary requests only after they reach this session’s or
                      an owned child agent’s permission broker. Hard and configured denials still
                      apply.
                    </div>
                  </div>
                  <Switch
                    aria-label="Approve all automatically"
                    checked={autoApprove}
                    disabled={setApprovalMode.isPending}
                    onChange={(enabled) => void changeApprovalMode(enabled)}
                  />
                </div>
                <div className="mt-2 text-small text-basic-tertiary">
                  This setting governs this session and all existing or future owned child agents.
                  It stays active across restarts until you turn it off and does not create
                  remembered permissions. Separately managed orchestrators are not included.
                </div>
              </section>
            ) : null}

            {active ? (
              <section aria-label="Requested access">
                <div className="mb-2 text-small text-basic-secondary">
                  Requested by {requesterLabel ?? "this session"} ({active.session_id}). Manual
                  approval is effective because automatic approval is off for this session and its
                  owned child agents.
                </div>
                <div className="mb-2 tag-label uppercase text-basic-tertiary">Requested access</div>
                <div className="flex flex-col gap-2">
                  {active.resources.map((resource, index) => (
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
              </section>
            ) : null}

            <section aria-label="Remembered permissions">
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
            </section>
          </div>
        )}
      </Modal>
    </>
  );
}
