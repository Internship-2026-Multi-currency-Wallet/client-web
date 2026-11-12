import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { authReducer, restoreSession, sessionChanged } from '../features/auth/authSlice';
import { serverTimeReducer } from '../features/server-time/serverTimeSlice';
import { settingsApi } from '../features/settings/settingsApi';
import { onSessionChange } from '../graphql/session';
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
    // Test callbacks must finish before jsdom removes its animation-frame globals.
    enhancers: (getDefault) =>
      getDefault(import.meta.env.MODE === 'test' ? { autoBatch: { type: 'tick' } } : {}),
    // RTK enables DevTools by default, also in production builds.
    devTools: import.meta.env.DEV,
  });

  detachSessionSync?.(); // a replaced store (tests, hot reload) stops listening
  detachSessionSync = onSessionChange((session) => {
    const userChanged = store.getState().auth.user?.id !== session?.user.id;
    store.dispatch(sessionChanged(session?.user ?? null));
    if (userChanged) {
      // Nothing of the previous user may stay cached. The public settings are put back at once: without them
      // SettingsGate would unmount the whole app until they are fetched again.
      const settings = settingsApi.endpoints.publicSettings.select()(store.getState()).data;
      store.dispatch(api.util.resetApiState());
      if (settings) {
        store.dispatch(
          settingsApi.util.upsertQueryEntries([
            { endpointName: 'publicSettings', arg: undefined, value: settings },
          ]),
        );
      }
    }
  });
  if (store.getState().auth.status === 'restoring') void store.dispatch(restoreSession());
  return store;
}

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
