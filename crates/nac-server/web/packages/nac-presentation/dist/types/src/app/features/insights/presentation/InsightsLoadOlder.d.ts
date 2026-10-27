/**
 * The snapshot carries only the newest messages, so the actions and threads of
 * earlier prompts join the list once their messages load, as in the chat.
 */
export declare function InsightsLoadOlder({ sessionId }: {
    sessionId: string;
}): import("react").JSX.Element;
