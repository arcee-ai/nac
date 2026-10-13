/** One presentation lifetime; hosted preferences are ephemeral. */
export declare function createComposerStore(_storage?: Pick<Storage, "getItem" | "setItem">): {
    release: () => void;
    shellIntents: {
        get: (sessionId: string) => import("../features/human-shell/intents").ShellIntent | undefined;
        claim(sessionId: string, command: string): import("../features/human-shell/intents").ShellIntent;
        confirmed(sessionId: string, intent: import("../features/human-shell/intents").ShellIntent): void;
        uncertain(sessionId: string, intent: import("../features/human-shell/intents").ShellIntent): void;
        release(): void;
    };
    sendPrompt: (pending: string) => void;
    consumePromptRequests: (send: (prompt: string) => void) => () => void;
    draftPrompt: (sessionId: string, text: string) => void;
    consumeDraftRequests: (sessionId: string, receive: (text: string) => void) => () => void;
};
export declare const release: () => void, sendPrompt: (pending: string) => void, consumePromptRequests: (send: (prompt: string) => void) => () => void, draftPrompt: (sessionId: string, text: string) => void, consumeDraftRequests: (sessionId: string, receive: (text: string) => void) => () => void, shellIntents: {
    get: (sessionId: string) => import("../features/human-shell/intents").ShellIntent | undefined;
    claim(sessionId: string, command: string): import("../features/human-shell/intents").ShellIntent;
    confirmed(sessionId: string, intent: import("../features/human-shell/intents").ShellIntent): void;
    uncertain(sessionId: string, intent: import("../features/human-shell/intents").ShellIntent): void;
    release(): void;
};
