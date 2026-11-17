import { useNativeRuntime } from "@/app/runtime/RuntimeContext";
import { InitialPromptBox, IconName } from "@/app/atoms";

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
  const { sendPrompt } = useNativeRuntime().stores.composerStore;

  return (
    <div className="flex flex-1 flex-col justify-center gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="type-heading text-basic-primary">Get started</h2>
        <p className="type-body-chrome text-basic-tertiary">
          Send a message below, or start with one of these.
        </p>
      </div>
      {/* Two up across the 720px column, one up on a phone. */}
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))]">
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
