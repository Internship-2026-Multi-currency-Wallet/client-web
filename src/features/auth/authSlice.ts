import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from '../../app/store';
import { refreshSession } from '../../graphql/client';
import {
  isAccessTokenExpired,
  loadSession,
  sessionGeneration,
  type SessionUser,
} from '../../graphql/session';

/**
 * - `restoring`: a stored session has an expired access token; the refresh cookie decides. Protected UI waits.
 * - `authenticated` / `anonymous`: settled.
 * - `unavailable`: restoring failed for a transient reason (network, 5xx). The stored session is kept; Retry.
 */
export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous' | 'unavailable';

export interface AuthState {
  status: AuthStatus;
  /** Set only while `authenticated`. Tokens stay in `graphql/session.ts`, never in Redux. */
  user: SessionUser | null;
}

// Lazy: read when the store is created (page load). Stored data is never trusted blindly: an expired token is
// not "logged in", it has to be renewed first.
function initialState(): AuthState {
  const session = loadSession();
  if (!session) return { status: 'anonymous', user: null };
  if (isAccessTokenExpired(session)) return { status: 'restoring', user: null };
  return { status: 'authenticated', user: session.user };
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionChanged(state, action: PayloadAction<SessionUser | null>) {
      state.user = action.payload;
      state.status = action.payload ? 'authenticated' : 'anonymous';
    },
    restoreStarted(state) {
      state.status = 'restoring';
      state.user = null;
    },
    // Only a restoration that is still waiting can fail: something newer (a session another tab renewed, a login, a
    // logout) may have settled the state while the failing attempt was on its way.
    restoreUnavailable(state) {
      if (state.status === 'restoring') state.status = 'unavailable';
    },
  },
});

export const { sessionChanged, restoreStarted, restoreUnavailable } = authSlice.actions;
export const authReducer = authSlice.reducer;
export const selectUser = (state: RootState) => state.auth.user;
export const selectAuthStatus = (state: RootState) => state.auth.status;

/**
 * Renews the stored session with the refresh cookie. Success and "refresh session over" reach the slice through
 * the session listener (see `createStore`); only a transient failure needs handling here.
 */
export const restoreSession = () => async (dispatch: AppDispatch, getState: () => RootState) => {
  const generation = sessionGeneration();
  dispatch(restoreStarted());
  try {
    await refreshSession();
    // Another tab may have renewed the session for us (no notification of our own): take it, whatever order the
    // storage event came in.
    const session = loadSession();
    if (session && getState().auth.status === 'restoring') dispatch(sessionChanged(session.user));
  } catch {
    // Not "invalid": do not clear anything. Unless the session changed meanwhile, which already settled the state
    // (the generation check) or something newer settled it without a new generation (the status check).
    if (generation === sessionGeneration() && getState().auth.status === 'restoring') {
      dispatch(restoreUnavailable());
    }
  }
};
