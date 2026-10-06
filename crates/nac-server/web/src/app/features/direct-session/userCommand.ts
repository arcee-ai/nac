// Composer recognition of `!command` input in direct-primary chats.

export type ComposerInput =
  | { kind: "command"; command: string }
  | { kind: "prompt"; prompt: string };

/** `directPrimary` is a direct chat the user owns; elsewhere `!` and `\!` are plain text. */
export function parseComposerInput(text: string, directPrimary: boolean): ComposerInput {
  if (directPrimary && text.startsWith("!")) {
    const command = text.slice(1);
    if (command.trim()) return { kind: "command", command };
  }
  if (directPrimary && text.startsWith("\\!"))
    return { kind: "prompt", prompt: text.slice(1).trim() };
  return { kind: "prompt", prompt: text.trim() };
}

export function isActiveUserCommand(state: string): boolean {
  return state === "admitted" || state === "executing";
}
