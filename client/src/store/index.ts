import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { sessionSlice } from './session-slice';
import { SIDEBAR_STORAGE_KEY, THEME_STORAGE_KEY, uiSlice } from './ui-slice';

const rootReducer = combineReducers({
  ui: uiSlice.reducer,
  session: sessionSlice.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({ reducer: rootReducer, preloadedState });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];

export const store = makeStore();

// Persist the two user preferences that must survive a reload.
let lastTheme = store.getState().ui.theme;
let lastCollapsed = store.getState().ui.sidebarCollapsed;
store.subscribe(() => {
  const { theme, sidebarCollapsed } = store.getState().ui;
  try {
    if (theme !== lastTheme) localStorage.setItem(THEME_STORAGE_KEY, theme);
    if (sidebarCollapsed !== lastCollapsed)
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  } catch {
    // Storage can be unavailable (private mode); preferences then last for the session only.
  }
  lastTheme = theme;
  lastCollapsed = sidebarCollapsed;
});

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
