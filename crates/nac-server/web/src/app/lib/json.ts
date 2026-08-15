// Decoded-JSON domain types shared by the wire, storage, and config readers.

/** A decoded JSON value, as `JSON.parse` yields it. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** Narrow a decoded JSON value to a non-array object. */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return Object(value) === value && !Array.isArray(value);
}
