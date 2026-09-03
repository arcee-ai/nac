import { useCallback, useMemo } from "react";

import ChildSessionActionButtons from "@/app/atoms/child-session-action-buttons";
import SessionTypeAvatar from "@/app/atoms/session-type-avatar";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { UserMessage } from "@/app/components/inspector/UserMessage";
import { SpawnSteerInput } from "@/app/features/delegation/presentation/SpawnSteerInput";
import { useChildSessionLive } from "@/app/hooks/useChildSessionLive";
import { useSpawnedChildSession } from "@/app/hooks/useSpawnedChildSession";
import { useStickToBottom } from "@/app/hooks/useStickToBottom";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { sessionTypeFromBehavior } from "@/app/lib/sessionBehavior";
import { buildTranscript, withStreamedOutput } from "@/app/lib/transcript";

/** Glide the preview onto a message the reader just sent, as the chat does. */
const SEND_FOLLOW_MS = 300;

export function ChildTranscriptPreview({
  parentSessionId,
  group,
  childSessionId,
}: {
  parentSessionId: string;
  group?: AgentToolsGroup;
  childSessionId?: string | null;
}) {
  const child = useSpawnedChildSession(parentSessionId, group ?? childSessionId ?? "");
  const live = useChildSessionLive(
    child.childId,
    Boolean(child.childId) && !child.missing,
    parentSessionId,
  );
  const running = child.running || live.running;
  // Same follow behavior as the chat transcript: the streamed child is glided
  // onto rather than snapped to, and the growth observer covers the height a
  // markdown block only settles on after it has laid out.
  const { scrollRef, contentRef, followLatest } = useStickToBottom({
    resetKey: child.childId,
  });

  const turns = useMemo(() => {
    return withStreamedOutput(buildTranscript(child.snapshot, {}, {}, []), {
      text: live.text,
      reasoning: live.reasoning,
    });
  }, [child.snapshot, live.reasoning, live.text]);

  const send = useCallback(
    async (prompt: string) => {
      const accepted = await child.send(prompt);
      // The prompt reaches the view with the next snapshot, so this only asks
      // the growth that follows to glide instead of tick.
      if (accepted) followLatest(SEND_FOLLOW_MS);
      return accepted;
    },
    [child.send, followLatest],
  );

  const model = child.snapshot?.metadata.model ?? "Model";
  const sessionType = sessionTypeFromBehavior(
    child.assignment?.child_behavior ?? child.snapshot?.metadata.behavior,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-muted px-3">
        <SessionTypeAvatar
          className="size-7 shrink-0"
          sessionType={child.sessionType}
          running={running}
        />
        <span
          className={`min-w-0 flex-1 truncate label-small ${
            running ? "text-shimmer-basic" : "text-basic-primary"
          }`}
        >
          {child.title}
        </span>
        {child.missing ? null : (
          <ChildSessionActionButtons
            state={running ? "running" : "ready"}
            busy={child.busy}
            canOpen={Boolean(child.childId)}
            onPause={() => void child.pause()}
            onPlay={() => void child.play()}
            onStop={() => void child.stop()}
            onOpen={child.open}
          />
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto [overflow-anchor:none]">
        <div ref={contentRef} className="flex flex-col px-4 py-2 [&>*]:shrink-0">
          {child.missing ? (
            <p className="label-small text-basic-muted">
              No chat found. Chat deleted or unrelated.
            </p>
          ) : !child.childId ? (
            <p className="label-small text-basic-muted">Starting session…</p>
          ) : turns.length === 0 ? (
            <p className="label-small text-basic-muted">
              {child.snapshotPending ? "Loading…" : running ? "Thinking…" : "No messages yet."}
            </p>
          ) : (
            turns.map((turn, index) => {
              if (turn.kind === "delegated-completion") return null;
              if (turn.kind === "user") {
                return (
                  <UserMessage
                    key={turn.key}
                    text={turn.text}
                    invokedSkills={turn.invokedSkills}
                    preview
                  />
                );
              }
              const last = index === turns.length - 1 && turn.kind === "model";
              return (
                <ModelMessage
                  key={turn.key}
                  turn={turn}
                  model={model}
                  sessionType={sessionType}
                  active={running && last}
                  isLast={false}
                  preview
                  spawnParentSessionId={child.childId ?? parentSessionId}
                  selectedThreadEpisode={null}
                  selectedWorkset={null}
                  selectedSpawn={null}
                  selectedAgentSegment={null}
                  onSelectThread={() => undefined}
                  onSelectWorkset={() => undefined}
                />
              );
            })
          )}
        </div>
      </div>
      {child.missing || !child.childId ? null : (
        <SpawnSteerInput disabled={child.busy} sending={child.busy} onSend={send} />
      )}
    </div>
  );
}
