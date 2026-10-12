import type { BackendKind, ResolvedModelConfiguration } from "../../types/api";
/**
 * The same rows as a fresh setup, filled in from a configuration the server
 * resolved. Everything stays editable — an edit rides along with the session
 * being created and leaves the stored configuration alone — except the key,
 * which never leaves the server and so can only be shown as a stand-in.
 *
 * A provider that signs in through the browser has no credential row here: its
 * sign-in is an action rather than a field, and lives below the box.
 */
export declare function ResolvedRows({ resolving, resolved, backend, onBackend, baseUrl, onBaseUrl, model, onModel, failed, }: {
    resolving: boolean;
    resolved: ResolvedModelConfiguration | null;
    backend: BackendKind | null;
    onBackend: (backend: BackendKind) => void;
    baseUrl: string;
    onBaseUrl: (url: string) => void;
    model: string;
    onModel: (model: string) => void;
    failed: boolean;
}): import("react").JSX.Element | null;
