import * as dockWidth from "../hooks/useDockWidth";
import * as panelWidth from "../hooks/usePanelListWidth";
import * as threadLogHeight from "../hooks/useThreadLogHeight";
import * as lastLight from "../lib/lastLight";
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
import { createInboxReadStore, standaloneInboxReadStore } from "../features/inbox/readStore";
import { createHomeDraftStore, standaloneHomeDraftStore } from "../features/home/homeDraftStore";
import {
  createCommandSurfaceStore,
  standaloneCommandSurfaceStore,
} from "../features/command-palette/commandSurfaceStore";
import {
  createTranscriptDensityStore,
  standaloneTranscriptDensityStore,
} from "../store/transcriptDensityStore";

export interface PresentationStores {
  inboxReadStore: ReturnType<typeof createInboxReadStore>;
  homeDraftStore: ReturnType<typeof createHomeDraftStore>;
  commandSurfaceStore: ReturnType<typeof createCommandSurfaceStore>;
  transcriptDensityStore: ReturnType<typeof createTranscriptDensityStore>;
  dockWidth: ReturnType<typeof dockWidth.createDockWidth>;
  panelWidth: ReturnType<typeof panelWidth.createPanelWidth>;
  threadLogHeight: ReturnType<typeof threadLogHeight.createThreadLogHeight>;
  lastLight: ReturnType<typeof lastLight.createLastLight>;
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

export function createPresentationStores(
  storage?: Pick<Storage, "getItem" | "setItem">,
  scope?: NativeRuntimeScope,
  draftStorage?: PromptDraftStorage,
  draftPersistenceBinding?: PromptDraftPersistenceBinding,
): PresentationStores {
  return {
    inboxReadStore: createInboxReadStore(storage),
    homeDraftStore: createHomeDraftStore(),
    commandSurfaceStore: createCommandSurfaceStore(),
    transcriptDensityStore: createTranscriptDensityStore(storage),
    promptDraftStore: promptDraftStore.createPromptDraftStore(
      scope,
      draftStorage,
      draftPersistenceBinding,
    ),
    dockWidth: dockWidth.createDockWidth(storage),
    panelWidth: panelWidth.createPanelWidth(storage),
    threadLogHeight: threadLogHeight.createThreadLogHeight(storage),
    lastLight: lastLight.createLastLight(storage),
    attentionStore: attentionStore.createAttentionStore(storage),
    chatTabsStore: chatTabsStore.createChatTabsStore(storage),
    composerStore: composerStore.createComposerStore(storage),
    runtimeStore: runtimeStore.createRuntimeStore(storage),
    sessionFiltersStore: sessionFiltersStore.createSessionFiltersStore(storage),
    sessionLayoutStore: sessionLayoutStore.createSessionLayoutStore(storage),
    sessionNavigationStore: sessionNavigationStore.createSessionNavigationStore(storage),
    sidebarLayoutStore: sidebarLayoutStore.createSidebarLayoutStore(storage),
    sshConnectionStore: sshConnectionStore.createSshConnectionStore(storage),
  };
}

export const standalonePresentationStores = {
  inboxReadStore: standaloneInboxReadStore,
  homeDraftStore: standaloneHomeDraftStore,
  commandSurfaceStore: standaloneCommandSurfaceStore,
  transcriptDensityStore: standaloneTranscriptDensityStore,
  promptDraftStore,
  dockWidth,
  panelWidth,
  threadLogHeight,
  lastLight,
  attentionStore: attentionStore,
  chatTabsStore: chatTabsStore,
  composerStore: composerStore,
  runtimeStore: runtimeStore,
  sessionFiltersStore: sessionFiltersStore,
  sessionLayoutStore: sessionLayoutStore,
  sessionNavigationStore: sessionNavigationStore,
  sidebarLayoutStore: sidebarLayoutStore,
  sshConnectionStore: sshConnectionStore,
};

export function releasePresentationStores(stores: PresentationStores): void {
  stores.runtimeStore.resetRuntime(null);
  for (const store of Object.values(stores)) store.release();
}
