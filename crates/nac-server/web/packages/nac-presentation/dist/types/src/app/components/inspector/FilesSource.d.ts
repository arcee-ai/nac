import { type FilesSource, type FilesSourceState } from "../../lib/filesSource";
/**
 * The line above the Files list saying which source its rows describe, with
 * the way back to the working tree whenever it describes something else.
 */
export declare function FilesSourceLabel({ source, state, autoSelected, onReturn, }: {
    source: FilesSource;
    state: FilesSourceState;
    /** The open file was picked for the reader, not by them. */
    autoSelected: boolean;
    onReturn: () => void;
}): import("react").JSX.Element;
