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
} from "@/app/services/queries";
import type { PermissionGrantRecord, PermissionReply, SessionBehavior } from "@/app/types/api";

import { useDelegatedPermissionStream } from "@/app/hooks/useSessionStream";
import { usePermissionQueue } from "@/app/features/permissions/usePermissionQueue";

interface PermissionControlsProps {
  sessionId: string;
  behavior: SessionBehavior | null;
  label?: string;
  autoApprovalAvailable?: boolean;
  requesterLabel?: string;
  /** The trigger drops its mode label but keeps any pending count; its accessible name stays. */
  compact?: boolean;
}

/** Subscription lifetime is independent of dialog visibility and request selection. */
function ChildPermissionBridge({ sessionId, running }: { sessionId: string; running: boolean }) {
  useDelegatedPermissionStream(sessionId, running);
  return null;
}

function GrantRow({
  grant,
  deleting,
  disabled,
  onDelete,
}: {
  grant: PermissionGrantRecord;
  deleting: boolean;
  disabled: boolean;
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
        disabled={disabled}
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
  compact = false,
}: PermissionControlsProps) {
  const direct = behavior === "direct" || behavior === "direct-with-orchestrator";
  const queue = usePermissionQueue(sessionId, direct, requesterLabel);
  const permissions = queue.parent;
  const replyPermission = useReplyPermission();
  const setApprovalMode = useSetPermissionApprovalMode();
  const deleteGrant = useDeletePermissionGrant();
  const toast = useToast();
  const requests = queue.requests;
  const grants = queue.scopes.flatMap((scope) => scope.query.data?.grants ?? []);
  const autoApprove = permissions.data?.approval_mode === "auto_approve";
  const inheritedAutoApproval = autoApprove && !autoApprovalAvailable;
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [dismissedRequests, setDismissedRequests] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [deletingGrant, setDeletingGrant] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const identity = JSON.stringify(requests.map((entry) => entry.key));
  // Each newly observed ask gets one automatic presentation. Closing the
  // dialog records that exact request set; a later request changes the
  // identity and opens it again without effect-driven state synchronization.
  const open = manuallyOpen || Boolean(requests.length && identity !== dismissedRequests);
  const close = () => {
    setDismissedRequests(identity);
    setManuallyOpen(false);
  };

  if (!direct) return null;

  const selected = requests.find((entry) => entry.key === selectedRequest) ?? requests[0] ?? null;
  const active = selected?.request ?? null;
  const requester = selected?.scope.label ?? requesterLabel ?? "this session";
  const requestUnavailable = selected?.scope.query.isError || selected?.scope.query.isPending;
  const busy = replyingTo !== null;
  const rememberable = active?.resources.some((resource) => resource.save_resource) ?? false;

  const reply = async (choice: PermissionReply) => {
    if (!active || !selected || busy || requestUnavailable) return;
    setReplyingTo(selected.key);
    try {
      await replyPermission.mutateAsync({
        sessionId: selected.scope.sessionId,
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

  const forget = async (scopeId: string, grant: PermissionGrantRecord) => {
    if (deletingGrant) return;
    setDeletingGrant(JSON.stringify([scopeId, grant.id]));
    try {
      await deleteGrant.mutateAsync({ sessionId: scopeId, grantId: grant.id });
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
  const modeName = autoApprove ? "Accept all" : "Manually";
  const modeDescription = inheritedAutoApproval
    ? "Requests are approved automatically because the parent session accepts all. Change the mode on the parent."
    : autoApprove
      ? "Requests are approved automatically for this session and the agents it owns."
      : "Each request pauses until you approve or deny it.";

  return (
    <>
      {queue.records.map((child) => (
        <ChildPermissionBridge
          key={child.child_session_id}
          sessionId={child.child_session_id}
          running={child.status === "running"}
        />
      ))}
      <Tooltip
        title={`Permission: ${modeName}`}
        description={modeDescription}
        position={TooltipPosition.TopCenter}
      >
        <Button
          size={ButtonSize.Small}
          variant={requests.length ? ButtonVariant.GhostHighlightedAccent : ButtonVariant.Ghost}
          content={compact && !requests.length ? ButtonContent.Icon : ButtonContent.IconLeft}
          aria-label={
            autoApprove
              ? inheritedAutoApproval
                ? `${label} — auto-approve inherited; open permissions`
                : "Auto-approve on — open permissions"
              : `${label}${badge}`
          }
          onClick={() => setManuallyOpen(true)}
        >
          <Icon iconName={IconName.Private} size={16} />
          {compact ? null : (
            <span className="label-micro">{autoApprove ? "Accept all" : "Manually"}</span>
          )}
          {requests.length ? (
            <span className="label-micro">({requests.length} pending)</span>
          ) : null}
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
            ? `${active.tool} requested by ${requester} is paused before execution.`
            : inheritedAutoApproval
              ? "Automatic approval is inherited from the parent session; change it from the parent."
              : autoApprove
                ? "Automatic approval is active for this session and its owned child agents."
                : "Remembered access for this session."
        }
        footer={
          active ? (
            <div className="flex w-full flex-wrap justify-end gap-2">
              <Button
                variant={ButtonVariant.SecondaryDestructive}
                loading={
                  replyingTo === selected?.key && replyPermission.variables?.reply === "reject"
                }
                disabled={busy || requestUnavailable}
                onClick={() => void reply("reject")}
              >
                Reject
              </Button>
              <Button
                variant={ButtonVariant.Secondary}
                loading={
                  replyingTo === selected?.key && replyPermission.variables?.reply === "once"
                }
                disabled={busy || requestUnavailable}
                onClick={() => void reply("once")}
              >
                Allow once
              </Button>
              <Button
                variant={ButtonVariant.Primary}
                loading={
                  replyingTo === selected?.key && replyPermission.variables?.reply === "always"
                }
                disabled={busy || requestUnavailable || !rememberable}
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
        <div className="flex flex-col gap-5">
          {[
            { sessionId: "discovery", label: "Child request discovery", query: queue.children },
            ...queue.scopes,
          ].map(({ sessionId: scopeId, label: scopeLabel, query }) =>
            query.isError ? (
              <div
                key={scopeId}
                role="alert"
                className="rounded-[4px] bg-error-secondary p-3 text-small text-error-primary"
              >
                Permissions could not be loaded for {scopeLabel}. The run remains fail-closed.
                <Button
                  size={ButtonSize.Small}
                  variant={ButtonVariant.Secondary}
                  onClick={() => void query.refetch()}
                >
                  Retry {scopeLabel}
                </Button>
              </div>
            ) : query.isPending ? (
              <div key={scopeId} role="status" className="text-small text-basic-secondary">
                Loading permissions for {scopeLabel}…
              </div>
            ) : null,
          )}
          {requests.length ? (
            <section aria-label="Pending permission requests" className="flex flex-col gap-2">
              <div className="tag-label uppercase text-basic-tertiary">
                Pending requests ({requests.length})
              </div>
              {requests.map((entry) => (
                <Button
                  key={entry.key}
                  variant={
                    entry.key === selected?.key ? ButtonVariant.Secondary : ButtonVariant.Ghost
                  }
                  className="!h-auto min-h-9 min-w-0 !py-2"
                  aria-pressed={entry.key === selected?.key}
                  disabled={busy}
                  onClick={() => setSelectedRequest(entry.key)}
                >
                  <span className="min-w-0 flex-1 whitespace-normal text-left [overflow-wrap:anywhere]">
                    {entry.scope.label} ({entry.scope.sessionId}): {entry.request.tool}
                  </span>
                </Button>
              ))}
            </section>
          ) : (
            <div className="text-small text-basic-secondary">No pending permission requests.</div>
          )}
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
                  disabled={
                    setApprovalMode.isPending || permissions.isError || permissions.isPending
                  }
                  onChange={(enabled) => void changeApprovalMode(enabled)}
                />
              </div>
              <div className="mt-2 text-small text-basic-tertiary">
                This setting governs this session and all existing or future owned child agents. It
                stays active across restarts until you turn it off and does not create remembered
                permissions. Separately managed orchestrators are not included.
              </div>
            </section>
          ) : null}

          {inheritedAutoApproval ? (
            <section
              aria-label="Inherited automatic approval mode"
              className="rounded-[6px] border border-accent-primary bg-elevation-level-2 p-3"
            >
              <div className="text-small font-medium text-basic-primary">
                Auto-approve inherited
              </div>
              <div className="mt-1 text-small text-basic-secondary">
                Ordinary requests from this child agent inherit automatic approval from the parent
                session. Change this mode from the parent session; hard and configured denials still
                apply.
              </div>
            </section>
          ) : null}

          {active ? (
            <section aria-label="Requested access">
              <div className="mb-2 text-small text-basic-secondary">
                Requested by {requester} ({active.session_id}). Manual approval is effective because
                automatic approval is off for this session and its owned child agents.
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
              Remembered permissions by session
            </div>
            <div className="mb-3 text-small text-basic-secondary">
              Each grant stays in its original session. A child’s grants never apply to the parent
              or siblings.
            </div>
            {queue.scopes.map((scope) => (
              <section
                key={scope.sessionId}
                aria-label={`Remembered for ${scope.label}`}
                className="mb-4"
              >
                <div className="mb-2 break-all text-small text-basic-secondary">
                  Remembered for {scope.label} ({scope.sessionId})
                </div>
                <div className="flex flex-col gap-2">
                  {scope.sessionId !== sessionId &&
                  scope.query.data?.approval_mode === "auto_approve" ? (
                    <div className="text-small text-basic-secondary">
                      Auto-approve inherited from parent.
                    </div>
                  ) : null}
                  {(scope.query.data?.grants ?? []).map((grant) => (
                    <GrantRow
                      key={grant.id}
                      grant={grant}
                      deleting={deletingGrant === JSON.stringify([scope.sessionId, grant.id])}
                      disabled={
                        deletingGrant !== null || scope.query.isError || scope.query.isPending
                      }
                      onDelete={() => void forget(scope.sessionId, grant)}
                    />
                  ))}
                </div>
                {!scope.query.isPending &&
                !scope.query.isError &&
                !scope.query.data?.grants.length ? (
                  <div className="text-small text-basic-secondary">No remembered permissions.</div>
                ) : null}
              </section>
            ))}
          </section>
        </div>
      </Modal>
    </>
  );
}
