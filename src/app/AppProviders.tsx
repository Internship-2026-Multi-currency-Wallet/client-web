import { CssBaseline, ThemeProvider } from '@mui/material';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import { GOOGLE_CALLBACK_PATH } from '../features/auth/googlePopup';
import { SettingsGate } from '../features/settings/SettingsGate';
import { GoogleCallbackPage } from '../pages/GoogleCallbackPage';
import type { AppStore } from './store';
import { theme } from './theme';

export function AppProviders({ store, children }: { store: AppStore; children: ReactNode }) {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* The callback only hands its code to the opener: it must not wait for settings that can fail to load. */}
        {location.pathname === GOOGLE_CALLBACK_PATH ? (
          <GoogleCallbackPage />
        ) : (
          <SettingsGate>{children}</SettingsGate>
        )}
      </ThemeProvider>
    </Provider>
  );
}
