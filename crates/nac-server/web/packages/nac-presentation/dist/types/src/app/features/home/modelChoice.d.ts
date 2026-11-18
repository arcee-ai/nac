import type { LaunchModelSelection } from "../setup/modelSelection";
import type { CreateSessionRequest } from "../../types/api";
/** A model picked for this session only. */
export interface ModelOverride {
    selection: LaunchModelSelection;
}
export declare function modelChipLabel(override: ModelOverride | null): string | null;
/** Compose a new session from the user's explicit model choice. */
export declare function configuredSessionRequest({ projectId, selected, }: {
    projectId: string;
    selected: LaunchModelSelection;
}): CreateSessionRequest;
