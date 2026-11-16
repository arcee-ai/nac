/** View disposal fences local callbacks; it never interrupts durable command settlement. */
export declare function useShellPresentation(binding: object, sessionId: string): import("react").RefObject<{
    current: () => boolean;
} | null>;
