/** One argument of the MCP server form. `id` keeps a row's input and focus across edits around it. */
export interface ArgRow {
    id: number;
    value: string;
}
export declare function newArgRow(value?: string): ArgRow;
export declare function argRows(args?: readonly string[]): ArgRow[];
/** One argument per row, in order: trimmed, blanks dropped (the old one-per-line policy), never split. */
export declare function argsFromRows(rows: readonly ArgRow[]): string[];
