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

export function rowsFromRecord(map: Record<string, string>): KvRow[] {
  return Object.entries(map).map(([key, preview]) => ({
    key,
    value: "",
    storedKey: key,
    placeholder: preview,
  }));
}

/**
 * Literal map for create/test payloads; null borrows the stored secret. A
 * blank value with nothing stored drops the row instead of sending "". A
 * stored row whose key was renamed still sends null, so the server rejects
 * the save with a clear error instead of silently deleting the secret.
 */
export function mapFromRows(rows: KvRow[]) {
  const map: Record<string, string | null> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (!row.value) {
      if (row.storedKey) map[key] = null;
      continue;
    }
    map[key] = row.value;
  }
  return map;
}

export function literalsOnly(
  map: Record<string, string | null>,
) {
  const literals: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    if (value !== null) literals[key] = value;
  }
  return literals;
}
