import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'aw-theme';
export const SIDEBAR_STORAGE_KEY = 'aw-sidebar-collapsed';

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function initialTheme(): ThemePreference {
  const saved = readStorage(THEME_STORAGE_KEY);
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
}

export interface UiState {
  theme: ThemePreference;
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
}

const initialState: UiState = {
  theme: initialTheme(),
  sidebarCollapsed: readStorage(SIDEBAR_STORAGE_KEY) === 'true',
  mobileNavOpen: false,
  commandPaletteOpen: false,
};

/** Client-only UI state. Server data never lives here (that is TanStack Query's job). */
export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<ThemePreference>) {
      state.theme = action.payload;
    },
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setMobileNavOpen(state, action: PayloadAction<boolean>) {
      state.mobileNavOpen = action.payload;
    },
    setCommandPaletteOpen(state, action: PayloadAction<boolean>) {
      state.commandPaletteOpen = action.payload;
    },
  },
});

export const { setTheme, toggleSidebar, setMobileNavOpen, setCommandPaletteOpen } = uiSlice.actions;
