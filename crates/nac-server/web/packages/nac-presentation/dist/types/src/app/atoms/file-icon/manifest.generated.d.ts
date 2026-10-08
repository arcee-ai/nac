/** Icon rendered for a file no association matches. */
export declare const FALLBACK_ICON = "file";
/** Whole file names, lowercased, such as `dockerfile` or `package.json`. */
export interface FileNameIconMap {
    [name: string]: string;
}
export declare const ICON_BY_FILE_NAME: FileNameIconMap;
/** Extensions without the leading dot, lowercased; some span several dots. */
export interface ExtensionIconMap {
    [extension: string]: string;
}
export declare const ICON_BY_EXTENSION: ExtensionIconMap;
