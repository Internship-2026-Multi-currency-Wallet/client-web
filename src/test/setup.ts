import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { clearSession, sessionWritesSettled } from '../graphql/session';
import { resetLogoutCoordinator } from '../features/auth/logoutCoordinator';
import { resetMockAuth } from '../mocks/auth-handlers';
import { server } from '../mocks/server';
import { FakeLockManager } from './fake-locks';

Object.defineProperty(navigator, 'locks', { value: new FakeLockManager(), configurable: true });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(async () => {
  cleanup();
  server.resetHandlers();
  clearSession(); // also resets the module's notion of the current user between tests
  await sessionWritesSettled(); // its storage write must not land after the next test started
  localStorage.clear();
  resetMockAuth();
  resetLogoutCoordinator();
});
afterAll(() => server.close());
