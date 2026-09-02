import { createStore } from "@/app/lib/store";

export interface ActionSegmentScroll {
  key: string;
  nonce: number;
}

const actionExpandStore = createStore(
  {
    expandedGroupId: null as string | null,
    scroll: null as ActionSegmentScroll | null,
  },
  "action-expand",
);

export function useExpandedActionGroupId(): string | null {
  return actionExpandStore.useStore((state) => state.expandedGroupId);
}

export function useActionSegmentScroll(): ActionSegmentScroll | null {
  return actionExpandStore.useStore((state) => state.scroll);
}

export function expandActionGroup(id: string): void {
  if (actionExpandStore.getState().expandedGroupId === id) return;
  actionExpandStore.setState({
    expandedGroupId: id,
  });
}

export function collapseActionGroup(): void {
  const current = actionExpandStore.getState();
  if (current.expandedGroupId === null && current.scroll === null) return;
  actionExpandStore.setState({
    expandedGroupId: null,
    scroll: null,
  });
}

export function toggleActionGroup(id: string): void {
  const current = actionExpandStore.getState().expandedGroupId;
  actionExpandStore.setState({
    expandedGroupId: current === id ? null : id,
  });
}

export function focusActionSegment(key: string): void {
  actionExpandStore.setState({
    scroll: { key, nonce: Date.now() },
  });
}
