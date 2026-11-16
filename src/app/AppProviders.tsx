import { CssBaseline, ThemeProvider } from '@mui/material';
import { lazy, Suspense, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { GOOGLE_CALLBACK_PATH } from '../features/auth/googlePopup';
import { SettingsGate } from '../features/settings/SettingsGate';
import type { AppStore } from './store';
import { theme } from './theme';

const GoogleCallbackPage = lazy(async () => ({
  default: (await import('../pages/GoogleCallbackPage')).GoogleCallbackPage,
}));

export function AppProviders({ store, children }: { store: AppStore; children: ReactNode }) {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* The callback only hands its code to the opener: it must not wait for settings that can fail to load. */}
        {location.pathname === GOOGLE_CALLBACK_PATH ? (
          <Suspense fallback={null}>
            <GoogleCallbackPage />
          </Suspense>
        ) : (
          <SettingsGate>{children}</SettingsGate>
        )}
      </ThemeProvider>
    </Provider>
  );
}
