import { BoxSurface, ChatLoader, CodeBlock } from "@/app/atoms";

const SAMPLE_CODE = `pub enum AgentEvent {
    RunStarted { run_id: String },
    AssistantMessage {
        content: String,
        usage: Option<TokenUsage>,
    },
    RunFinished { run_id: String },
}`;

export function CodeBlockSection() {
  return (
    <BoxSurface title="Code block and chat loader">
      <div className="p-4 flex flex-col gap-4">
        <CodeBlock
          code={SAMPLE_CODE}
          language="rust"
          title="events.rs"
          lineNumbers
          expandable
          maxHeight="220px"
        />
        <ChatLoader />
      </div>
    </BoxSurface>
  );
}
