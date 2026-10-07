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

export function createPresentationStores(storage?: Pick<Storage, "getItem" | "setItem">) {
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
export type PresentationStores = ReturnType<typeof createPresentationStores>;

export function releasePresentationStores(stores: PresentationStores): void {
  stores.runtimeStore.resetRuntime(null);
  for (const store of Object.values(stores)) store.release();
}
