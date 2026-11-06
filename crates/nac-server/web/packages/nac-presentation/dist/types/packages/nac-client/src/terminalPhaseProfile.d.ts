type Phase = "fetch_begin" | "fetch_headers" | "json" | "parser_begin" | "parser_end" | "ack_ready";
export interface ProfileKey {
    observer?: string;
    cursor?: string;
    request?: string;
}
export declare function phaseKey(path: string, body: unknown, request: string): ProfileKey | undefined;
export declare function phaseClock(): number;
export declare function phaseRecord(phase: Phase, started: number, key: ProfileKey): void;
export {};
