import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { resetMockAuth } from '../mocks/auth-handlers';
import { resetMockGoogle } from '../mocks/google-handlers';
import { server } from '../mocks/server';

configure({ asyncUtilTimeout: 5000 });

// jsdom has no Web Locks: an exclusive queue per lock name, enough for `navigator.locks.request(name, callback)`.
const queues = new Map<string, Promise<unknown>>();
Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    request(name: string, callback: () => Promise<unknown>) {
      const run = (queues.get(name) ?? Promise.resolve()).then(() => callback());
      queues.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
  },
});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  resetMockAuth();
  resetMockGoogle();
});
afterAll(() => server.close());
