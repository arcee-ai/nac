import { Data } from "effect";

/** Typed failure of a NAC HTTP program. The original client error stays on `error`. */
export class ClientRequestError extends Data.TaggedError("ClientRequestError")<{
  readonly error: unknown;
}> {}
