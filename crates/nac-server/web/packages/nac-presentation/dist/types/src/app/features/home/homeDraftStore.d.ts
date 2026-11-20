export interface HomeDraft {
    text: string;
    revision: number;
    /** The project the text was last written for, so a later move can be shown. */
    projectId: string | null;
}
/** The unsent Home prompt belongs to one presentation, including return visits. */
export declare function createHomeDraftStore(): {
    get: () => HomeDraft;
    usePrompt: () => string;
    useProjectId: () => string | null;
    update(text: string, projectId?: string | null): void;
    acknowledge(revision: number): void;
    release(): void;
};
export declare const standaloneHomeDraftStore: {
    get: () => HomeDraft;
    usePrompt: () => string;
    useProjectId: () => string | null;
    update(text: string, projectId?: string | null): void;
    acknowledge(revision: number): void;
    release(): void;
};
