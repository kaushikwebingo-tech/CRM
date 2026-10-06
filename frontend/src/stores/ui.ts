import { create } from 'zustand';

export interface UiState {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  selectedRecords: Set<string>;
  toggleRecord: (id: string) => void;
  clearSelection: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  selectedRecords: new Set<string>(),
  toggleRecord: (id: string) =>
    set((state) => {
      const newSelection = new Set(state.selectedRecords);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      return { selectedRecords: newSelection };
    }),
  clearSelection: () => set({ selectedRecords: new Set<string>() }),
}));
