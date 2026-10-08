/** Invalidate helpers shared by every mutation below. */
export declare function useQueryInvalidators(): {
    sessions: () => Promise<void>;
    projects: () => Promise<void>;
    session: (id: string) => Promise<void>;
    sessionRoot: (id: string) => Promise<void>;
};
