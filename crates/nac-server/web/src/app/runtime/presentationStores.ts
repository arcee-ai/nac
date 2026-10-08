import * as panelWidth from "../hooks/usePanelListWidth";
import * as threadLogHeight from "../hooks/useThreadLogHeight";
import * as lastLight from "../lib/lastLight";
import * as attentionStore from "../store/attentionStore";
import * as chatTabsStore from "../store/chatTabsStore";
import * as composerStore from "../store/composerStore";
import * as runtimeStore from "../store/runtimeStore";
import * as sessionFiltersStore from "../store/sessionFiltersStore";
import * as sessionLayoutStore from "../store/sessionLayoutStore";
import * as sessionNavigationStore from "../store/sessionNavigationStore";
import * as sidebarLayoutStore from "../store/sidebarLayoutStore";
import * as sshConnectionStore from "../store/sshConnectionStore";

export interface PresentationStores {
  panelWidth: ReturnType<typeof panelWidth.createPanelWidth>;
  threadLogHeight: ReturnType<typeof threadLogHeight.createThreadLogHeight>;
  lastLight: ReturnType<typeof lastLight.createLastLight>;
  attentionStore: ReturnType<typeof attentionStore.createAttentionStore>;
  chatTabsStore: ReturnType<typeof chatTabsStore.createChatTabsStore>;
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
): PresentationStores {
  return {
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
