/** UI delivery only. This port carries no server, file, shell or input authority. */
export type DesktopUIAction = "newSession" | "settings" | "projects";
export interface DesktopCommandPort {
    connect(owner: (message: unknown) => boolean): () => void;
}
export type DesktopUIOwners = Record<DesktopUIAction, () => void>;
export declare function connectDesktopCommands(port: DesktopCommandPort | undefined, owners: DesktopUIOwners): () => void;
/** Browser-only startup has no injected capability and installs nothing. */
export declare function readDesktopCommandPort(source: unknown): DesktopCommandPort | undefined;
