import { ModelPill } from "@/app/atoms";
import { ChatBadge } from "@/app/components/inspector/ChatBadge";
import { ThreadWave } from "@/app/components/inspector/ThreadWave";
import { formatDurationShort, formatSeconds } from "@/app/lib/format";
import { Markdown } from "@/app/lib/markdown";
import type { ModelTurn } from "@/app/lib/transcript";

interface ModelMessageProps {
  turn: ModelTurn;
  model: string;
  /** Draws the spinner ring while this turn is the one still producing output. */
  active: boolean;
  /** What the run is doing right now, named only while this turn is active. */
  activity?: string;
  selectedThread: string | null;
  onSelectThread: (name: string) => void;
  onSelectWorkset: (id: string) => void;
}

/**
 * Everything the orchestrator did for one prompt, in the order it happened:
 * reasoning, prose, the worksets it saved and the waves of threads it ran.
 */
export function ModelMessage({
  turn,
  model,
  active,
  activity,
  selectedThread,
  onSelectThread,
  onSelectWorkset,
}: ModelMessageProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <ModelPill active={active} />
        <span className="label-small text-basic-secondary truncate">{model}</span>
        {/* The header carries whichever of the two is available: what the run is
            doing now, or how long it took once it is over. */}
        {active && activity ? (
          <span className="label-micro text-shimmer-basic min-w-0 truncate">
            {activity}
          </span>
        ) : turn.durationMs != null ? (
          <span className="label-micro text-basic-tertiary shrink-0">
            {formatDurationShort(turn.durationMs)}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col items-start gap-1 pl-1">
        {turn.blocks.map((block) => {
          switch (block.kind) {
            case "thoughts":
              return (
                <ChatBadge
                  key={block.key}
                  label={
                    block.durationMs == null
                      ? "Thoughts"
                      : `Thoughts, ${formatSeconds(block.durationMs)}`
                  }
                  body={block.text}
                />
              );
            case "text":
              return (
                <div
                  key={block.key}
                  className="markdown paragraph-medium text-basic-secondary w-full"
                >
                  <Markdown>{block.text}</Markdown>
                </div>
              );
            case "workset":
              return (
                <ChatBadge
                  key={block.key}
                  label={
                    block.pending
                      ? "Defining worksets…"
                      : `Worksets_${block.worksetId}`
                  }
                  pending={block.pending}
                  onClick={() => onSelectWorkset(block.worksetId)}
                />
              );
            case "tool":
              return (
                <ChatBadge
                  key={block.key}
                  label={block.pending ? `${block.name}…` : block.name}
                  pending={block.pending}
                />
              );
            case "wave":
              return (
                <ThreadWave
                  key={block.key}
                  threads={block.threads}
                  selected={selectedThread}
                  onSelect={onSelectThread}
                />
              );
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
