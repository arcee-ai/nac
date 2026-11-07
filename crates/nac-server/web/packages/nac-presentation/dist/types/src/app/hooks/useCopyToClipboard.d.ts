export type CopyOutcome = "idle" | "copied" | "failed";
export declare function useCopyToClipboard(): {
    copied: boolean;
    outcome: CopyOutcome;
    copy: (content: string) => void;
};
