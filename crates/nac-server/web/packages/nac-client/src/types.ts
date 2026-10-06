import type { ApiSchema } from "./openapi.generated.js";

export type ReadinessResponse = ApiSchema<"ReadinessResponse">;
export type RecentEventsResponse = ApiSchema<"RecentEventsResponse">;
export type SessionEventBoundary = ApiSchema<"SessionEventBoundary">;
export type SessionEventEnvelope = ApiSchema<"SessionEventEnvelope">;
export type SessionSnapshotResponse = ApiSchema<"SessionSnapshotResponse">;
export type SubmitPromptResponse = ApiSchema<"SubmitPromptResponse">;
export type AssistantStreamDelta = ApiSchema<"AssistantStreamDelta">;
export type LaggedEvent = ApiSchema<"LaggedEvent">;
export type ReplayBoundaryEvent = ApiSchema<"ReplayBoundaryEvent">;
export type ReplayGapEvent = ApiSchema<"ReplayGapEvent">;

export type UiConfiguration = ApiSchema<"UiConfiguration">;

export type ShellCommandRequest = ApiSchema<"ShellCommandRequest">;
export type ShellCommandSnapshot = ApiSchema<"ShellCommandSnapshot">;
export type ShellOutputPage = ApiSchema<"ShellOutputPage">;
