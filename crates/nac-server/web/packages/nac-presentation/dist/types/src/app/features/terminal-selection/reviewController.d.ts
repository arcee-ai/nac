import type { NativeApi } from "../../services/api";
import type { TerminalSelectionPreviewResponse, TerminalSelectionSubmissionResponse, TerminalSelectionDelivery } from "../../types/api";
import type { TerminalSelectionCapture } from "../terminal/TerminalPane";
/** The pane snapshots rendered text only at an explicit user capture point. */
export type SelectionCapture = TerminalSelectionCapture;
export type SelectionSource = Omit<SelectionCapture, "selectedText">;
export interface DeliveryChoice {
    readonly delivery: TerminalSelectionDelivery;
    readonly runId?: string;
}
export interface ReviewSnapshot {
    readonly phase: "empty" | "previewing" | "editing" | "reviewed" | "sending" | "uncertain" | "accepted" | "error";
    readonly source?: SelectionSource;
    readonly editorText: string;
    readonly canPreview?: boolean;
    readonly preview?: TerminalSelectionPreviewResponse;
    readonly choice: DeliveryChoice;
    readonly error?: string;
    readonly receipt?: TerminalSelectionSubmissionResponse;
}
interface ReviewPorts {
    readonly sessionId: string;
    readonly api: Pick<NativeApi, "previewUserTerminalSelection" | "submitUserTerminalSelection">;
    readonly captureActivation: () => () => boolean;
    readonly accepted: () => void;
}
/** Private ephemeral originals; only canonical previews enter the public snapshot.
 * No request variables or draft text are retained in a query/mutation cache.
 */
export declare class SelectionReviewController {
    #private;
    private readonly ports;
    constructor(ports: ReviewPorts);
    readonly getSnapshot: () => ReviewSnapshot;
    readonly subscribe: (listener: () => void) => () => boolean;
    readonly retain: () => () => void;
    capture(capture: Readonly<SelectionCapture>, choice: DeliveryChoice): void;
    setUserText(text: string): void;
    editUserText(): void;
    choose(choice: DeliveryChoice): void;
    preview(): Promise<void>;
    send(): Promise<void>;
    retry(): Promise<void>;
    clear(): void;
    dispose(): void;
}
export {};
