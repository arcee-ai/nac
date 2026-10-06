export type ShellInput = { kind: "command"; command: string } | { kind: "prompt"; prompt: string };

/** Only the first byte is syntax. Every byte after ! belongs to the shell. */
export function shellInput(value: string): ShellInput {
  if (value.startsWith("\\!")) return { kind: "prompt", prompt: value.slice(1) };
  if (value.startsWith("!")) return { kind: "command", command: value.slice(1) };
  return { kind: "prompt", prompt: value };
}
