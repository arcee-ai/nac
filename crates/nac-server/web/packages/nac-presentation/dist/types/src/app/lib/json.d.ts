/** A decoded JSON value, as `JSON.parse` yields it. */
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
export type JsonObject = {
    [key: string]: JsonValue;
};
/** Narrow a decoded JSON value to a non-array object. */
export declare function isJsonObject(value: JsonValue): value is JsonObject;
