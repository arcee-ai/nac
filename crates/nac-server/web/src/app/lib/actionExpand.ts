import { createStore } from "@/app/lib/store";

export interface ActionSegmentScroll {
  key: string;
  nonce: number;
}

const initialState = {
  expandedGroupId: null as string | null,
  selectedSegmentKey: null as string | null,
  scroll: null as ActionSegmentScroll | null,
};

const actionExpandStore = createStore(initialState, "action-expand");

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
    current.selectedSegmentKey === null &&
    current.scroll === null
  ) {
    return;
  }
  actionExpandStore.setState(initialState);
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
  const previous = actionExpandStore.getState().scroll;
  actionExpandStore.setState({
    selectedSegmentKey: key,
    scroll: { key, nonce: (previous?.nonce ?? 0) + 1 },
  });
}

/** Restore view-only selection state when the owning surface unmounts or resets. */
export function resetActionExpansion(): void {
  actionExpandStore.setState(initialState);
}
