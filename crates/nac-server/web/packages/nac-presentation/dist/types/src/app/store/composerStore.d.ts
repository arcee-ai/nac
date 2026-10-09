/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createComposerStore(_storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    sendPrompt: (pending: string) => void;
    consumePromptRequests: (send: (prompt: string) => void) => () => void;
};
export declare const release: () => void, sendPrompt: (pending: string) => void, consumePromptRequests: (send: (prompt: string) => void) => () => void;
