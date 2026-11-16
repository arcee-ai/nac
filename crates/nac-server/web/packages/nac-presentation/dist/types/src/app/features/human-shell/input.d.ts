export type ShellInput = {
    kind: "command";
    command: string;
} | {
    kind: "prompt";
    prompt: string;
};
/** Only the first byte is syntax. Every byte after ! belongs to the shell. */
export declare function shellInput(value: string): ShellInput;
