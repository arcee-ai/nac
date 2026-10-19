import { type RunError } from "../lib/providerError";
export interface ErrorNotice {
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
    };
}
/**
 * Turns a failure into the notice the chat shows, with the offered fix wired to
 * whatever carries it out from here: the browser login, this session's
 * settings, the page on the platform that holds the account, or a retry the
 * caller supplies. A fix nothing here can perform is dropped, leaving the
 * wording to stand on its own. For a backend that signs in, the server's record
 * of whether a login is on file outranks what the failure text claims.
 */
export declare function useErrorNotice(sessionId: string | null, backend?: string | null): (error: RunError, retry?: () => void) => ErrorNotice;
