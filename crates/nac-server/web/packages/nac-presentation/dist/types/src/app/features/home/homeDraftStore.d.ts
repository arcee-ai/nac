/** The unsent Home prompt belongs to one presentation, including return visits. */
export declare function createHomeDraftStore(): {
    get: () => {
        text: string;
        revision: number;
    };
    usePrompt: () => string;
    update(text: string): void;
    acknowledge(revision: number): void;
    release(): void;
};
export declare const standaloneHomeDraftStore: {
    get: () => {
        text: string;
        revision: number;
    };
    usePrompt: () => string;
    update(text: string): void;
    acknowledge(revision: number): void;
    release(): void;
};
