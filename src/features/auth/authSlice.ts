import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from '../../app/store';
import { refreshSession } from '../../graphql/refresh';
import { isAccessTokenExpired, loadSession, type SessionUser } from '../../graphql/session';

/** `restoring`: the stored access token has expired and is being renewed; protected UI waits. */
export type AuthStatus = 'restoring' | 'authenticated' | 'anonymous';

export interface AuthState {
  status: AuthStatus;
  /** Tokens stay in `graphql/session.ts`, never in Redux. */
  user: SessionUser | null;
}

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
  },
});

export const { sessionChanged } = authSlice.actions;
export const authReducer = authSlice.reducer;
export const selectUser = (state: RootState) => state.auth.user;
export const selectAuthStatus = (state: RootState) => state.auth.status;

export const restoreSession = () => async (dispatch: AppDispatch) => {
  try {
    await refreshSession();
  } catch {
    // Server unreachable is not a logout: the next request tries again.
  }
  dispatch(sessionChanged(loadSession()?.user ?? null));
};
