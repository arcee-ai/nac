import { type SessionStreamHandlers, type SessionStreamOptions } from "../../../packages/nac-client/src/eventStream.js";
export * from "../../../packages/nac-client/src/eventStream.js";
export declare function subscribeToSessionEvents(sessionId: string, handlers: SessionStreamHandlers, options?: SessionStreamOptions): () => void;
