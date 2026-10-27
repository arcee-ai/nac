import { type ThreadLogLine } from "../../../lib/threadLog";
/** Command log filling the detail pane. */
export declare function LogPane({ lines, running, hasOlder, loadingOlder, loadingInitial, historyError, onRetry, onLoadOlder, className, }: {
    lines: ThreadLogLine[];
    running: boolean;
    hasOlder: boolean;
    loadingOlder: boolean;
    loadingInitial: boolean;
    historyError: string | null;
    onLoadOlder: () => Promise<void>;
    onRetry: () => Promise<void>;
    className?: string;
}): import("react").JSX.Element;
