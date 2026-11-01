import { CssBaseline, ThemeProvider } from '@mui/material';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import type { AppStore } from './store';
import { theme } from './theme';

export function AppProviders({ store, children }: { store: AppStore; children: ReactNode }) {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </Provider>
  );
}
