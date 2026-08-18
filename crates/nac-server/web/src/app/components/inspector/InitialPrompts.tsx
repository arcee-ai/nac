import { InitialPromptBox, IconName } from "@/app/atoms";
import { sendPrompt } from "@/app/store/composerStore";

interface Prompt {
  icon: IconName;
  title: string;
  /** Sent as written, so it has to read as an instruction on its own. */
  prompt: string;
}

const PROMPTS: Prompt[] = [
  {
    icon: IconName.FolderOpen,
    title: "Explore this repository",
    prompt: "Understand the project structure, key components, and how they work together.",
  },
  {
    icon: IconName.Eye,
    title: "Review current changes",
    prompt:
      "Review the working tree for bugs, regressions, and opportunities to simplify the code.",
  },
  {
    icon: IconName.SearchPage,
    title: "Find something to improve",
    prompt:
      "Identify one meaningful improvement, explain its impact, and propose an implementation plan.",
  },
  {
    icon: IconName.Bolt,
    title: "Help me get started",
    prompt:
      "Read the project documentation and suggest the best first task based on the current repository state",
  },
];

/**
 * What a session with nothing in it shows instead of a transcript: four prompts
 * to open with. Picking one sends it straight away, which is why the card shows
 * the prompt itself rather than a summary of it.
 */
export function InitialPrompts() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-2">
      <p className="text-[10px] leading-[12px] font-medium uppercase text-input-placeholder">
        Get started
      </p>
      {/* Columns are 360px at minimum, so the chat is 2-up beside the side box
          at the design's desktop width and 1-up wherever it is narrower. */}
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]">
        {PROMPTS.map((entry) => (
          <InitialPromptBox
            key={entry.title}
            icon={entry.icon}
            title={entry.title}
            description={entry.prompt}
            onClick={() => sendPrompt(entry.prompt)}
          />
        ))}
      </div>
    </div>
  );
}
