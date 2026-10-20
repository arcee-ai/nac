/** One argument of the MCP server form. `id` keeps a row's input and focus across edits around it. */
export interface ArgRow {
  id: number;
  value: string;
}

let nextId = 0;

export function newArgRow(value = ""): ArgRow {
  nextId += 1;
  return { id: nextId, value };
}

export function argRows(args: readonly string[] | null | undefined): ArgRow[] {
  return (args ?? []).map((value) => newArgRow(value));
}

/** One argument per row, in order: trimmed, blanks dropped (the old one-per-line policy), never split. */
export function argsFromRows(rows: readonly ArgRow[]): string[] {
  return rows.map((row) => row.value.trim()).filter(Boolean);
}
