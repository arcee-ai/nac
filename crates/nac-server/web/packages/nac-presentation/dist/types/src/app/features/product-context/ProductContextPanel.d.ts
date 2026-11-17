/**
 * Settings › Capabilities: what this runtime is and offers, read fresh. Opening
 * a destination goes through the runtime's bounded navigation bridge; it never
 * submits a form or starts work. `sessionId` scopes the facts to the session
 * the user came from, when they came from one.
 */
export declare function ProductContextPanel({ sessionId }: {
    sessionId: string | null;
}): import("react").JSX.Element;
