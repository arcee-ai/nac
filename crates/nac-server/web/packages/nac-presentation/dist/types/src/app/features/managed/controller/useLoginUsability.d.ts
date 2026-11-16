export type LoginUsability = "unusable" | "unknown" | "usable";
/** Whether the login a refused run needed works now, wherever the sign-in happened. */
export declare function useLoginUsability(backend: string | null, refusal: string | null): LoginUsability;
