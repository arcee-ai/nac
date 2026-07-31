import { useEffect, useMemo, useRef } from "react";

import { cn } from "@/app/lib/cn";
import { displayPromptFromMessageText, formatDurationShort } from "@/app/lib/format";
import { Markdown } from "@/app/lib/markdown";
import { useActivity, useRunError, useRunning } from "@/app/store/runtimeStore";
import type { Message, MessageRole, SessionSnapshotResponse } from "@/app/types/api";

// Long sessions would otherwise render thousands of markdown blocks.
const MAX_MESSAGES = 80;

interface TranscriptMessage {
  key: string;
  index: number;
  role: MessageRole;
  content: string;
  rawContent: string;
  durationMs: number | null;
}

function mapMessages(snapshot: SessionSnapshotResponse | null): TranscriptMessage[] {
  const raw: Message[] = snapshot?.messages ?? [];
  const durations = snapshot?.response_timing.response_durations_ms ?? [];
  let assistantIndex = -1;

  const mapped = raw.map((message, index): TranscriptMessage => {
    const role = message.role;
    const rawContent = typeof message.content === "string" ? message.content : "";
    let content = rawContent;

    if (role === "user") content = displayPromptFromMessageText(rawContent);
    if (role === "assistant" && !content && message.tool_calls?.length) {
      const names = message.tool_calls
        .map((call) => call.function?.name ?? "tool")
        .join(", ");
      content = `_(tool calls: ${names})_`;
    }
    if (role === "tool") content = "```\n" + rawContent + "\n```";

    let durationMs: number | null = null;
    if (role === "assistant") {
      assistantIndex += 1;
      durationMs = durations[assistantIndex] ?? null;
    }

    return { key: `${role}-${index}`, index, role, content, rawContent, durationMs };
  });

  return mapped.length > MAX_MESSAGES ? mapped.slice(-MAX_MESSAGES) : mapped;
}

const ROLE_STYLE: Record<MessageRole, string> = {
  user: "border-accent-primary bg-elevation-level-1",
  assistant: "border-secondary bg-elevation-level-1",
  system: "border-secondary bg-elevation-level-0-5",
  tool: "border-secondary bg-elevation-level-0-5",
};

function MessageRow({
  role,
  content,
  index,
  durationMs = null,
  pending = false,
}: {
  role: MessageRole;
  content: string;
  index?: number;
  durationMs?: number | null;
  pending?: boolean;
}) {
  return (
    <div className={cn("rounded-xl p-3 border", ROLE_STYLE[role])}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="tag-label text-basic-muted">{role}</span>
        <span className="text-micro text-basic-muted font-mono">
          {pending ? "submitted" : `#${index}`}
          {durationMs != null ? ` · ${formatDurationShort(durationMs)}` : ""}
        </span>
      </div>
      <div className="markdown paragraph-medium text-basic-secondary">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );
}

/**
 * Read-only transcript from the canonical snapshot plus a live typing indicator
 * fed by the SSE runtime store. Auto-scrolls to the bottom on new content.
 */
export function Transcript({ snapshot }: { snapshot: SessionSnapshotResponse | null }) {
  const running = useRunning();
  const activity = useActivity();
  const error = useRunError();
  const messages = useMemo(() => mapMessages(snapshot), [snapshot]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // While a run is in flight the just-submitted user message may not be in the
  // persisted snapshot yet; surface it from active_run so the chat feels live.
  const submitted = running ? snapshot?.active_run?.submitted_user_message : undefined;
  const pendingText = submitted
    ? displayPromptFromMessageText(submitted.content)
    : "";
  const last = messages[messages.length - 1];
  const showPending = Boolean(
    pendingText &&
      !(
        last?.role === "user" &&
        displayPromptFromMessageText(last.rawContent) === pendingText
      ),
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, running, activity, showPending]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
      {/* The top bar is fixed over this scroll region, so the first message
          needs to clear it. */}
      <div className="flex flex-col gap-3 pt-[72px] pb-4">
        {!snapshot ? (
          <div className="text-basic-muted label-small">Loading…</div>
        ) : null}

        {snapshot && messages.length === 0 && !running && !showPending ? (
          <div className="text-basic-muted label-small">
            No messages yet. Type something below.
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageRow
            key={message.key}
            role={message.role}
            content={message.content}
            index={message.index}
            durationMs={message.durationMs}
          />
        ))}

        {showPending ? (
          <MessageRow role="user" content={pendingText} pending />
        ) : null}

        {running ? (
          <div className="rounded-xl p-3 border border-secondary bg-elevation-level-1">
            <div className="tag-label text-basic-muted mb-1">assistant</div>
            <div className="flex items-center gap-2 paragraph-medium text-basic-tertiary">
              <span className="text-shimmer-accent">{activity || "Working…"}</span>
              <span className="stream-caret" />
            </div>
          </div>
        ) : null}

        {error && !running ? (
          <div className="rounded-xl p-3 border border-error-primary bg-error-tertiary text-error-primary label-small">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
