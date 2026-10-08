/**
 * One header or env line of the MCP server form. `storedKey` marks a secret
 * that lives on the server under that key: the input shows the redacted
 * preview as a placeholder, and an empty value sends null so the stored value
 * survives untouched. A library template's auth row carries only a hint
 * placeholder.
 */
export interface KvRow {
    key: string;
    value: string;
    storedKey?: string;
    placeholder?: string;
}
export declare function rowsFromRecord(map: Record<string, string>): KvRow[];
/**
 * Literal map for create/test payloads; null borrows the stored secret. A
 * blank value with nothing stored drops the row instead of sending "". A
 * stored row whose key was renamed still sends null, so the server rejects
 * the save with a clear error instead of silently deleting the secret.
 */
export declare function mapFromRows(rows: KvRow[]): Record<string, string | null>;
export declare function literalsOnly(map: Record<string, string | null>): Record<string, string>;
