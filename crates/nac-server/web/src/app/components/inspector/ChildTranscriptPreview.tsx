import { useEffect, useMemo, useRef } from "react";

import ChildSessionActionButtons from "@/app/atoms/child-session-action-buttons";
import SessionTypeAvatar from "@/app/atoms/session-type-avatar";
import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import { UserMessage } from "@/app/components/inspector/UserMessage";
import { useChildSessionLive } from "@/app/hooks/useChildSessionLive";
import { useSpawnedChildSession } from "@/app/hooks/useSpawnedChildSession";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { sessionTypeFromBehavior } from "@/app/lib/sessionBehavior";
import { buildTranscript, withStreamedOutput } from "@/app/lib/transcript";

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
  const live = useChildSessionLive(child.childId, Boolean(child.childId) && !child.missing, parentSessionId);
  const running = child.running || live.running;
  const scrollerRef = useRef<HTMLDivElement>(null);

  const turns = useMemo(() => {
    return withStreamedOutput(buildTranscript(child.snapshot, {}, {}, []), {
      text: live.text,
      reasoning: live.reasoning,
    });
  }, [child.snapshot, live.reasoning, live.text]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
  }, [turns, live.text, live.reasoning]);

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
      <div
        ref={scrollerRef}
        className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-2 [&>*]:shrink-0"
      >
        {child.missing ? (
          <p className="label-small text-basic-muted">
            No chat found. Chat deleted or unrelated.
          </p>
        ) : !child.childId ? (
          <p className="label-small text-basic-muted">Starting session…</p>
        ) : turns.length === 0 ? (
          <p className="label-small text-basic-muted">
            {running ? "Thinking…" : "No messages yet."}
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
  );
}
