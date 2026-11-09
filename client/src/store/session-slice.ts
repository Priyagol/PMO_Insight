import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { PermissionMap, SessionDto, UserDto } from '@arihant/shared';

export type SessionStatus = 'restoring' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: UserDto | null;
  permissions: PermissionMap;
  /**
   * True when the person signed out on purpose. The sign-in page then opens without
   * `?next=`, so whoever signs in next starts at their own home page instead of the
   * page the previous person was on. An expired session keeps `?next=`.
   */
  signedOut: boolean;
}

const initialState: SessionState = {
  status: 'restoring',
  user: null,
  permissions: {},
  signedOut: false,
};

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
      state.signedOut = false;
      state.user = action.payload.user;
      state.permissions = action.payload.permissions;
    },
    sessionUserUpdated(state, action: PayloadAction<UserDto>) {
      state.user = action.payload;
    },
    /**
     * Marks a deliberate sign-out before the server call. Requests still running on the open
     * page fail once the session is revoked and end it as "expired"; this flag keeps that
     * from carrying the old page over to the next person.
     */
    signOutStarted(state) {
      state.signedOut = true;
    },
    sessionEnded(state, action: PayloadAction<{ signedOut?: boolean } | undefined>) {
      return {
        ...initialState,
        status: 'anonymous' as const,
        signedOut: Boolean(action.payload?.signedOut) || state.signedOut,
      };
    },
  },
});

export const { sessionStarted, sessionUserUpdated, signOutStarted, sessionEnded } =
  sessionSlice.actions;
