import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app/AppProviders';
import { AppRouter } from './app/AppRouter';
import { createStore } from './app/store';
import { config } from './config-env';

async function enableMocks(): Promise<void> {
  // The literal `import.meta.env` check lets Vite drop the mocks from builds without them.
  if (import.meta.env.VITE_USE_MOCKS !== 'true' || !config.useMocks) return;
  const { worker } = await import('./mocks/browser');
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true });
}

await enableMocks();

const store = createStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders store={store}>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
);
