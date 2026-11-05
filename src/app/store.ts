import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { authReducer, restoreSession, sessionChanged } from '../features/auth/authSlice';
import { clearPrivateCache } from '../features/auth/privateCache';
import { onSessionChange } from '../graphql/session';
import { serverTimeReducer } from '../features/server-time/serverTimeSlice';
import { api } from './api';

let detachSessionSync: (() => void) | undefined;

/** Root store. Each feature adds its slice here in a small, dedicated PR. */
export function createStore() {
  const store = configureStore({
    reducer: {
      [api.reducerPath]: api.reducer,
      auth: authReducer,
      serverTime: serverTimeReducer,
    },
    middleware: (getDefault) => getDefault().concat(api.middleware),
  });
  // The session lives in localStorage (graphql/session.ts); mirror its changes (login, silent refresh, logout,
  // another tab) into Redux. Another user (or nobody) means the private cache goes; a token refresh keeps it.
  detachSessionSync?.(); // one live store per app: a replaced store (tests, hot reload) stops listening
  detachSessionSync = onSessionChange(({ session }) => {
    // Compare with the user THIS store currently shows, not with what localStorage held before: another tab may
    // already have switched the stored session to user B while this store still holds user A's data.
    const previousUserId = store.getState().auth.user?.id ?? null;
    const nextUserId = session?.user.id ?? null;
    store.dispatch(sessionChanged(session?.user ?? null));
    if (previousUserId !== nextUserId) store.dispatch(clearPrivateCache());
  });
  // A stored session with an expired token is renewed before any protected UI is shown.
  if (store.getState().auth.status === 'restoring') void store.dispatch(restoreSession());
  return store;
}

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
