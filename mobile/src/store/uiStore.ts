import { create } from 'zustand';

export type TabKey = 'dashboard' | 'inventory' | 'consumption' | 'stocktake' | 'forecast' | 'account';
export type ThemePreference = 'system' | 'light' | 'dark';

interface UiState {
  activeTab: TabKey;
  themePref: ThemePreference;
  focusedForecastProductId: number | null;
  focusedMovementProductId: number | null;
  setActiveTab: (tab: TabKey) => void;
  setThemePref: (pref: ThemePreference) => void;
  openForecastForProduct: (productId: number) => void;
  openMovementForProduct: (productId: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTab: 'inventory',
  themePref: 'system',
  focusedForecastProductId: null,
  focusedMovementProductId: null,
  setActiveTab: (activeTab) => set({ activeTab }),
  setThemePref: (themePref) => set({ themePref }),
  openForecastForProduct: (productId) =>
    set({ activeTab: 'forecast', focusedForecastProductId: productId }),
  openMovementForProduct: (productId) =>
    set({ activeTab: 'consumption', focusedMovementProductId: productId }),
}));
