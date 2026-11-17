import { useId, type ReactNode } from "react";

import { Button, ButtonSize, ButtonVariant, KeyboardShortcut } from "@/app/atoms";
import type { PermissionQueueEntry } from "@/app/features/permissions/usePermissionQueue";
import { cn } from "@/app/lib/cn";
import type { PermissionReply } from "@/app/types/api";

import {
  actionLabel,
  alwaysAllowLabel,
  presentPermission,
  rememberedScopes,
} from "./permissionModel";
import type { PermissionReplyState } from "./usePermissionReply";

interface PermissionDecisionProps {
  entry: PermissionQueueEntry;
  /** Who asked, as the queue labels it ("this session", "child agent “…”"). */
  requester: string;
  replying: PermissionReplyState["replying"];
  onReply: (choice: PermissionReply) => void;
  /** Draw ⏎ and D beside the choices they press. */
  showKeys?: boolean;
  /** 44px choices for a touch screen. */
  touch?: boolean;
  /** Extra explanation at the head of the requested access. */
  context?: ReactNode;
  className?: string;
}

/**
 * What one request would authorize, and the three ways to answer it. Every
 * resource the broker attached is shown in full — this is what is being
 * approved — and "Always allow" names the exact rules it would store.
 */
export function PermissionDecision({
  entry,
  requester,
  replying,
  onReply,
  showKeys = false,
  touch = false,
  context,
  className,
}: PermissionDecisionProps) {
  const id = useId();
  const request = entry.request;
  const presentation = presentPermission(request);
  const scopes = rememberedScopes(request);
  const rememberable = scopes.length > 0;
  const unavailable = entry.scope.query.isError || entry.scope.query.isPending;
  const busy = replying !== null;
  const disabled = busy || unavailable;
  const loading = (choice: PermissionReply) =>
    replying?.key === entry.key && replying.choice === choice;
  const size = touch ? ButtonSize.Large : ButtonSize.Medium;

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="min-w-0">
        <h3 id={`${id}-title`} className="type-subheading text-basic-primary">
          {presentation.title}
        </h3>
        <p className="type-meta mt-0.5 break-words text-basic-tertiary">
          {`${request.tool} requested by ${requester} is paused before execution.`}
        </p>
      </div>

      <section aria-label="Requested access" className="flex min-w-0 flex-col gap-2">
        {context}
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-tertiary bg-[var(--f-wash-1)] p-3">
          <div
            tabIndex={0}
            role="group"
            aria-label={presentation.command ? "Command" : "Request"}
            className={cn(
              "code max-h-[min(40vh,320px)] min-w-0 overflow-auto text-[12.5px] leading-[1.6] text-basic-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--f-focus)] rounded-xs",
              presentation.command
                ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
                : "whitespace-pre-wrap break-words",
            )}
          >
            {presentation.primary.map((resource, index) => (
              <div key={`${resource.action}:${resource.resource}:${index}`}>
                {presentation.primary.length > 1 || !presentation.command ? (
                  <span className="select-none text-basic-tertiary">
                    {actionLabel(resource.action)}{" "}
                  </span>
                ) : null}
                {resource.display || resource.resource}
              </div>
            ))}
          </div>
          {presentation.secondary.length ? (
            <dl className="flex min-w-0 flex-col gap-1 border-t border-muted pt-2">
              {presentation.secondary.map((resource, index) => (
                <div
                  key={`${resource.action}:${resource.resource}:${index}`}
                  className="flex min-w-0 flex-wrap gap-x-2"
                >
                  <dt className="type-meta shrink-0 text-basic-tertiary">
                    {actionLabel(resource.action)}
                  </dt>
                  <dd className="code min-w-0 flex-1 text-[12.5px] whitespace-pre-wrap [overflow-wrap:anywhere] text-basic-secondary">
                    {resource.display || resource.resource}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </section>

      {rememberable ? (
        <p id={`${id}-always`} className="type-meta min-w-0 text-basic-tertiary">
          Always allow remembers{" "}
          {scopes.map((scope, index) => (
            <span key={`${scope.action}:${scope.scope}`}>
              {index > 0 ? ", " : null}
              <span className="text-basic-secondary">{actionLabel(scope.action)}</span>{" "}
              <code className="code break-all text-[12px] text-basic-secondary">{scope.scope}</code>
            </span>
          ))}{" "}
          for {entry.scope.label}. Change it later under Review all.
        </p>
      ) : (
        <p id={`${id}-always`} className="type-meta text-basic-tertiary">
          This operation has no safe reusable permission pattern, so it can only be allowed once.
        </p>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          size={size}
          variant={ButtonVariant.Primary}
          loading={loading("once")}
          disabled={disabled}
          onClick={() => onReply("once")}
        >
          Allow once
          {showKeys ? (
            <span aria-hidden className="ml-1.5">
              <KeyboardShortcut keys={["enter"]} inversed />
            </span>
          ) : null}
        </Button>
        <Button
          size={size}
          variant={ButtonVariant.Secondary}
          loading={loading("always")}
          disabled={disabled || !rememberable}
          aria-label="Always allow"
          aria-describedby={`${id}-always`}
          title={
            rememberable
              ? "Remember the server-derived narrow access pattern"
              : "This operation has no safe reusable permission pattern"
          }
          className="max-w-full min-w-0"
          onClick={() => onReply("always")}
        >
          <span className="min-w-0 truncate">{alwaysAllowLabel(scopes)}</span>
        </Button>
        <Button
          size={size}
          variant={ButtonVariant.Ghost}
          loading={loading("reject")}
          disabled={disabled}
          onClick={() => onReply("reject")}
        >
          Deny
          {showKeys ? (
            <span aria-hidden className="ml-1.5">
              <KeyboardShortcut keys={["d"]} />
            </span>
          ) : null}
        </Button>
      </div>
    </div>
  );
}
