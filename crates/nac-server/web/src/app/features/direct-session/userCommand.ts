// Composer recognition of `!command` input in direct-primary chats.

export type ComposerInput =
  | { kind: "command"; command: string }
  | { kind: "unsupported-command"; command: string }
  | { kind: "prompt"; prompt: string };

/** Recognize shell intent before prompt/steering admission, even when unsupported. */
export function parseComposerInput(text: string, directPrimary: boolean): ComposerInput {
  if (text.startsWith("!")) {
    const command = text.slice(1);
    if (command.trim()) return { kind: directPrimary ? "command" : "unsupported-command", command };
  }
  if (text.startsWith("\\!")) return { kind: "prompt", prompt: text.slice(1).trim() };
  return { kind: "prompt", prompt: text.trim() };
}

export function isActiveUserCommand(state: string): boolean {
  return state === "admitted" || state === "executing";
}
