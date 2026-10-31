/** Available only in an identified local desktop presentation. The chosen path
 * is form data, never permission or project admission. */
export interface NativeDirectoryPort {
    chooseDirectory(initialPath: string, signal: AbortSignal): Promise<string | null>;
}
export declare function readNativeDirectoryPort(source: unknown): NativeDirectoryPort | undefined;
/** Runtime retirement aborts the native panel even before React removes the
 * initiating form. A late successful adapter result cannot cross this fence. */
export declare function bindNativeDirectoryPort(port: NativeDirectoryPort | undefined, lifetime: AbortSignal): NativeDirectoryPort | undefined;
export declare function localDirectoryCapability(port: NativeDirectoryPort | undefined, local: boolean, kind: string, ssh: unknown): NativeDirectoryPort | undefined;
/** One form invocation. Detach cancels the native sheet and fences callbacks,
 * including adapters that settle after cancellation. No result is replayed. */
export declare function selectLocalFolder(port: NativeDirectoryPort, initialPath: string, callbacks: {
    selected: (path: string) => void;
    cancelled: () => void;
    failed: (error: unknown) => void;
}): {
    cancel: () => void;
    settled: Promise<void>;
};
