import { createStore } from "@/app/lib/store";

export interface ActionSegmentScroll {
  key: string;
  nonce: number;
}

const actionExpandStore = createStore(
  {
    expandedGroupId: null as string | null,
    selectedSegmentKey: null as string | null,
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

export function useSelectedActionSegmentKey(): string | null {
  return actionExpandStore.useStore((state) => state.selectedSegmentKey);
}

export function expandActionGroup(id: string): void {
  if (actionExpandStore.getState().expandedGroupId === id) return;
  actionExpandStore.setState({
    expandedGroupId: id,
    selectedSegmentKey: null,
    scroll: null,
  });
}

export function collapseActionGroup(): void {
  const current = actionExpandStore.getState();
  if (
    current.expandedGroupId === null &&
    current.scroll === null &&
    current.selectedSegmentKey === null
  ) {
    return;
  }
  actionExpandStore.setState({
    expandedGroupId: null,
    selectedSegmentKey: null,
    scroll: null,
  });
}

export function toggleActionGroup(id: string): void {
  const current = actionExpandStore.getState().expandedGroupId;
  actionExpandStore.setState({
    expandedGroupId: current === id ? null : id,
    selectedSegmentKey: null,
    scroll: null,
  });
}

export function focusActionSegment(key: string): void {
  actionExpandStore.setState({
    selectedSegmentKey: key,
    scroll: { key, nonce: Date.now() },
  });
}
