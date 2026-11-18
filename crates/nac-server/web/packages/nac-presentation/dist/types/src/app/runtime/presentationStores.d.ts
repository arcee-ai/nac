import * as dockWidth from "../hooks/useDockWidth";
import * as panelWidth from "../hooks/usePanelListWidth";
import * as threadLogHeight from "../hooks/useThreadLogHeight";
import * as attentionStore from "../store/attentionStore";
import * as chatTabsStore from "../store/chatTabsStore";
import * as promptDraftStore from "../store/promptDraftStore";
import type { NativeRuntimeScope } from "./nativeRuntime";
import type { PromptDraftPersistenceBinding, PromptDraftStorage } from "../store/promptDraftStore";
import * as composerStore from "../store/composerStore";
import * as runtimeStore from "../store/runtimeStore";
import * as sessionFiltersStore from "../store/sessionFiltersStore";
import * as sessionLayoutStore from "../store/sessionLayoutStore";
import * as sessionNavigationStore from "../store/sessionNavigationStore";
import * as sidebarLayoutStore from "../store/sidebarLayoutStore";
import * as sshConnectionStore from "../store/sshConnectionStore";
import { createInboxReadStore } from "../features/inbox/readStore";
import { createHomeDraftStore } from "../features/home/homeDraftStore";
import { createCommandSurfaceStore } from "../features/command-palette/commandSurfaceStore";
import { createTranscriptDensityStore } from "../store/transcriptDensityStore";
export interface PresentationStores {
    inboxReadStore: ReturnType<typeof createInboxReadStore>;
    homeDraftStore: ReturnType<typeof createHomeDraftStore>;
    commandSurfaceStore: ReturnType<typeof createCommandSurfaceStore>;
    transcriptDensityStore: ReturnType<typeof createTranscriptDensityStore>;
    dockWidth: ReturnType<typeof dockWidth.createDockWidth>;
    panelWidth: ReturnType<typeof panelWidth.createPanelWidth>;
    threadLogHeight: ReturnType<typeof threadLogHeight.createThreadLogHeight>;
    attentionStore: ReturnType<typeof attentionStore.createAttentionStore>;
    chatTabsStore: ReturnType<typeof chatTabsStore.createChatTabsStore>;
    promptDraftStore: ReturnType<typeof promptDraftStore.createPromptDraftStore>;
    composerStore: ReturnType<typeof composerStore.createComposerStore>;
    runtimeStore: ReturnType<typeof runtimeStore.createRuntimeStore>;
    sessionFiltersStore: ReturnType<typeof sessionFiltersStore.createSessionFiltersStore>;
    sessionLayoutStore: ReturnType<typeof sessionLayoutStore.createSessionLayoutStore>;
    sessionNavigationStore: ReturnType<typeof sessionNavigationStore.createSessionNavigationStore>;
    sidebarLayoutStore: ReturnType<typeof sidebarLayoutStore.createSidebarLayoutStore>;
    sshConnectionStore: ReturnType<typeof sshConnectionStore.createSshConnectionStore>;
}
export declare function createPresentationStores(storage?: Pick<Storage, "getItem" | "setItem">, scope?: NativeRuntimeScope, draftStorage?: PromptDraftStorage, draftPersistenceBinding?: PromptDraftPersistenceBinding): PresentationStores;
export declare const standalonePresentationStores: {
    inboxReadStore: {
        firstSeen: Map<string, number>;
        release(): void;
        useReadState: () => import("../features/inbox/inboxModel").InboxReadState;
        getState: () => import("../features/inbox/inboxModel").InboxReadState;
        markRead(sessionId: string, runId: string): void;
        markAllRead(marks: ReadonlyArray<{
            sessionId: string;
            runId: string;
        }>): void;
    };
    homeDraftStore: {
        get: () => {
            text: string;
            revision: number;
        };
        usePrompt: () => string;
        update(text: string): void;
        acknowledge(revision: number): void;
        release(): void;
    };
    commandSurfaceStore: {
        openCommandPalette: () => void;
        openShortcutSheet: () => void;
        closeCommandSurfaces: () => void;
        useCommandSurface: () => import("../features/command-palette/commandSurfaceStore").CommandSurface;
        useSidebarToggleAvailable: () => boolean;
        registerSidebarToggle(handler: () => void): () => void;
        requestSidebarToggle(): boolean;
        release(): void;
    };
    transcriptDensityStore: {
        useTranscriptDensity: () => import("../store/transcriptDensityStore").TranscriptDensity;
        setTranscriptDensity: (density: import("../store/transcriptDensityStore").TranscriptDensity) => void;
        toggleTranscriptDensity: () => void;
        release(): void;
    };
    promptDraftStore: typeof promptDraftStore;
    dockWidth: typeof dockWidth;
    panelWidth: typeof panelWidth;
    threadLogHeight: typeof threadLogHeight;
    attentionStore: typeof attentionStore;
    chatTabsStore: typeof chatTabsStore;
    composerStore: typeof composerStore;
    runtimeStore: typeof runtimeStore;
    sessionFiltersStore: typeof sessionFiltersStore;
    sessionLayoutStore: typeof sessionLayoutStore;
    sessionNavigationStore: typeof sessionNavigationStore;
    sidebarLayoutStore: typeof sidebarLayoutStore;
    sshConnectionStore: typeof sshConnectionStore;
};
export declare function releasePresentationStores(stores: PresentationStores): void;
