import { useState } from "react";
import {
  Button,
  ButtonSize,
  ButtonVariant,
  Icon,
  IconName,
  Popover,
  PopoverPlacement,
} from "@/app/atoms";
import { useSessionIntegrations } from "./queries";
import type { SessionMcpRefreshStatus } from "@/app/types/api";

const STATE_LABEL: Record<SessionMcpRefreshStatus["state"], string> = {
  current: "Integrations are current for this chat.",
  pending: "Changes will apply before the next model request.",
  scheduled_for_workers:
    "Changes will apply to this orchestrator’s workers before their next model request.",
  degraded: "Some integrations are unavailable.",
  failed: "Integrations could not refresh.",
};

export function SessionIntegrations({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const { status, refresh, requestRefresh } = useSessionIntegrations(sessionId, open);
  const data = status.data;
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      sticky
      focusScope="Chat integrations"
      className="shrink-0"
      placement={PopoverPlacement.BottomLeft}
      size="w-[320px]"
      content={
        <div className="flex flex-col gap-3 p-3">
          <p className="label-small text-basic-primary">Chat integrations</p>
          <p className="text-micro text-basic-tertiary">
            Apply newly connected, changed or removed MCP servers to this chat. Other chats keep
            their own integrations.
          </p>
          <p className="text-micro text-basic-primary" role="status">
            {data
              ? STATE_LABEL[data.state]
              : status.isError
                ? "Could not load integrations."
                : "Loading integrations…"}
          </p>
          {data?.revision ? (
            <p className="text-micro text-basic-tertiary">
              Refresh {data.revision}
              {data.applied_revision != null ? ` · Applied ${data.applied_revision}` : ""}
            </p>
          ) : null}
          {data?.message ? <p className="text-micro text-basic-tertiary">{data.message}</p> : null}
          {refresh.error ? (
            <p className="text-micro text-danger-primary" role="alert">
              {refresh.error.message}
            </p>
          ) : null}
          {status.isError ? (
            <Button
              size={ButtonSize.Small}
              variant={ButtonVariant.Secondary}
              onClick={() => void status.refetch()}
            >
              Retry
            </Button>
          ) : null}
          <Button
            size={ButtonSize.Small}
            variant={ButtonVariant.Secondary}
            disabled={!data || refresh.isPending}
            onClick={() => data && requestRefresh(data.revision)}
          >
            {refresh.isPending ? "Scheduling refresh…" : "Refresh integrations"}
          </Button>
        </div>
      }
    >
      <Button
        size={ButtonSize.Small}
        variant={ButtonVariant.Tertiary}
        aria-label="Chat integrations"
        title="Chat integrations"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon iconName={IconName.Server} size={16} className="@sm:!hidden" />
        <span className="@max-sm:hidden">Integrations</span>
      </Button>
    </Popover>
  );
}
