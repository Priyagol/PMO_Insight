import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PermissionMap, SessionDto, UserDto } from '@arihant/shared';

export type SessionStatus = 'restoring' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: UserDto | null;
  permissions: PermissionMap;
}

const initialState: SessionState = { status: 'restoring', user: null, permissions: {} };

/**
 * Who is signed in and what they may do. The access token itself is kept outside Redux
 * (in memory in the API client) so it never ends up in dev-tools or persisted state.
 */
export const sessionSlice = createSlice({
  name: 'session',
  initialState,
  reducers: {
    sessionStarted(state, action: PayloadAction<SessionDto>) {
      state.status = 'authenticated';
      state.user = action.payload.user;
      state.permissions = action.payload.permissions;
    },
    sessionUserUpdated(state, action: PayloadAction<UserDto>) {
      state.user = action.payload;
    },
    sessionEnded() {
      return { ...initialState, status: 'anonymous' as const };
    },
  },
});

export const { sessionStarted, sessionUserUpdated, sessionEnded } = sessionSlice.actions;
