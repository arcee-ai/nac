/** Narrow primitive values without invoking object coercion hooks. */
export function isString(value: unknown): value is string {
  return (
    value !== null &&
    value !== undefined &&
    Object(value) !== value &&
    value.constructor === String
  );
}

export function isNumber(value: unknown): value is number {
  return (
    value !== null &&
    value !== undefined &&
    Object(value) !== value &&
    value.constructor === Number
  );
}
