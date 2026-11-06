import { afterEach, describe, expect, it, vi } from 'vitest';
import { devToolsOptions, redactSecrets } from './devtools';

const loginPending = {
  type: 'api/executeMutation/pending',
  meta: {
    arg: {
      endpointName: 'login',
      originalArgs: { email: 'a@example.com', password: 'Secret123!' },
    },
  },
};

describe('redactSecrets', () => {
  it('redacts passwords and tokens wherever RTK Query puts them, without touching the original', () => {
    const original = structuredClone(loginPending);
    const redacted = redactSecrets(loginPending);

    expect(redacted.meta.arg.originalArgs).toEqual({
      email: 'a@example.com',
      password: '[redacted]',
    });
    expect(JSON.stringify(redacted)).not.toContain('Secret123!');
    expect(loginPending).toEqual(original); // the dispatched action is unchanged
    expect(redacted).not.toBe(loginPending);

    const fulfilled = { type: 'x', payload: { accessToken: 'jwt', list: [{ refreshToken: 'r' }] } };
    expect(JSON.stringify(redactSecrets(fulfilled))).not.toMatch(/jwt|"r"/);
    expect(fulfilled.payload.accessToken).toBe('jwt');
  });

  it('returns the very same object when there is nothing to redact', () => {
    const action = { type: 'auth/sessionChanged', payload: { id: '1', email: 'a@example.com' } };
    expect(redactSecrets(action)).toBe(action);
  });
});

describe('redactSecrets limits', () => {
  it('never returns an uninspected branch: a too deep or cyclic action is cut off, not passed through', () => {
    let deep: unknown = { password: 'Secret123!' };
    for (let i = 0; i < 15; i++) deep = { nested: deep };
    expect(JSON.stringify(redactSecrets({ type: 'x', payload: deep }))).not.toContain('Secret123!');

    const cyclic: Record<string, unknown> = { password: 'Secret123!' };
    cyclic.self = cyclic;
    expect(JSON.stringify(redactSecrets({ type: 'x', payload: cyclic }))).not.toContain(
      'Secret123!',
    );
  });
});

describe('redactSecrets and non-plain objects', () => {
  it('replaces a class instance instead of letting its inherited toJSON() reveal a secret', () => {
    class Credentials {
      readonly #secret: string;
      constructor(secret: string) {
        this.#secret = secret;
      }
      toJSON() {
        return { password: this.#secret };
      }
    }
    const instance = new Credentials('Secret123!');
    const toJSON = vi.spyOn(Credentials.prototype, 'toJSON');
    const action = { type: 'x', payload: { credentials: instance } };

    const redacted = redactSecrets(action);

    expect(JSON.stringify(redacted)).not.toContain('Secret123!');
    expect(redacted.payload.credentials).toBe('[unsupported]');
    expect(toJSON).not.toHaveBeenCalled(); // decided by the prototype, the method is never run
    expect(action.payload.credentials).toBe(instance); // the dispatched action is unchanged
  });

  it('replaces an Array subclass with its own toJSON() as well', () => {
    class Secrets extends Array<string> {
      toJSON() {
        return { password: 'Secret123!' };
      }
    }
    const redacted = redactSecrets({ type: 'x', payload: new Secrets() });
    expect(JSON.stringify(redacted)).not.toContain('Secret123!');
    expect(redacted.payload).toBe('[unsupported]');
  });

  it('replaces plain objects and arrays that carry their own toJSON, without running it or its getter', () => {
    const run = vi.fn(() => ({ password: 'Secret123!' }));
    const plain = { safe: 1, toJSON: run };
    const hidden = Object.defineProperty({ safe: 1 }, 'toJSON', { value: run, enumerable: false });
    const array = Object.assign([1, 2], { toJSON: run });
    const getter = vi.fn(() => run);
    const accessor = Object.defineProperty({ safe: 1 }, 'toJSON', {
      get: getter,
      enumerable: true,
    });
    const action = { type: 'x', payload: { plain, hidden, array, accessor } };

    const redacted = redactSecrets(action);

    expect(JSON.stringify(redacted)).not.toContain('Secret123!');
    expect(redacted.payload).toEqual({
      plain: '[unsupported]',
      hidden: '[unsupported]',
      array: '[unsupported]',
      accessor: '[unsupported]',
    });
    expect(run).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    expect(action.payload.plain).toBe(plain); // the dispatched action is unchanged
  });

  it('still walks null-prototype objects and keeps plain values', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { password: 'p' });
    expect(redactSecrets({ type: 'x', bare, n: 1, s: 'a', list: [1, 'b'] })).toEqual({
      type: 'x',
      bare: { password: '[redacted]' },
      n: 1,
      s: 'a',
      list: [1, 'b'],
    });
  });
});

describe('devToolsOptions', () => {
  it('is off in production and sanitizes actions in development', () => {
    expect(devToolsOptions(false)).toBe(false);
    const options = devToolsOptions(true);
    expect(options).toMatchObject({ actionSanitizer: expect.any(Function) });
  });

  it('redacts whatever action id Redux passes as the second argument', () => {
    // Redux calls `actionSanitizer(action, id)`; the id must not leak into the redaction itself.
    const sanitize = (
      devToolsOptions(true) as { actionSanitizer: (a: unknown, id: number) => unknown }
    ).actionSanitizer;
    for (const id of [0, 8, 11, 5000]) {
      expect(JSON.stringify(sanitize(loginPending, id))).not.toContain('Secret123!');
    }
  });
});

describe('store wiring', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@reduxjs/toolkit');
  });

  // What the store passes to `configureStore` is the whole contract; RTK itself is not re-tested here.
  async function devToolsPassedToConfigureStore(isDevelopment: boolean) {
    const options: { devTools?: unknown }[] = [];
    vi.doMock('@reduxjs/toolkit', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@reduxjs/toolkit')>();
      return {
        ...actual,
        configureStore: ((o: { devTools?: unknown }) => {
          options.push(o);
          return actual.configureStore(o as never);
        }) as typeof actual.configureStore,
      };
    });
    vi.stubEnv('DEV', isDevelopment);
    vi.resetModules();
    const { createStore } = await import('./store');
    createStore();
    return options[0].devTools;
  }

  it('turns the Redux DevTools off in a production build', async () => {
    expect(await devToolsPassedToConfigureStore(false)).toBe(false);
  });

  it('keeps them in development, with the credential sanitizer', async () => {
    const devTools = (await devToolsPassedToConfigureStore(true)) as {
      actionSanitizer: typeof redactSecrets;
    };
    expect(JSON.stringify(devTools.actionSanitizer(loginPending))).not.toContain('Secret123!');
  });
});

describe('real Login/Register actions', () => {
  it('reach DevTools with the password redacted and nothing replaced as unsupported', async () => {
    const { configureStore } = await import('@reduxjs/toolkit');
    type Middleware = import('@reduxjs/toolkit').Middleware;
    const { api } = await import('./api');
    const { authApi } = await import('../features/auth/authApi');
    const seen: unknown[] = [];
    const capture: Middleware = () => (next) => (action) => {
      seen.push(action);
      return next(action);
    };
    const store = configureStore({
      reducer: { [api.reducerPath]: api.reducer },
      middleware: (getDefault) => getDefault().concat(api.middleware).concat(capture),
    });
    const sanitize = (devToolsOptions(true) as { actionSanitizer: (a: unknown) => unknown })
      .actionSanitizer;

    // The outcomes are asserted first: the test must cover successful AND rejected actions, not only failures.
    const registered = await store.dispatch(
      authApi.endpoints.register.initiate({
        email: 'new.user@example.com',
        password: 'Reg1ster!x',
      }),
    );
    expect(registered.data?.email).toBe('new.user@example.com');
    const loggedIn = await store.dispatch(
      authApi.endpoints.login.initiate({ email: 'demo@example.com', password: 'Demo1234!' }),
    );
    expect(loggedIn.data?.email).toBe('demo@example.com');
    const rejected = await store.dispatch(
      authApi.endpoints.login.initiate({ email: 'demo@example.com', password: 'Wrong-pass1!' }),
    );
    expect(rejected.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(seen.map((a) => (a as { type: string }).type)).toEqual(
      expect.arrayContaining(['api/executeMutation/fulfilled', 'api/executeMutation/rejected']),
    );

    const raw = JSON.stringify(seen);
    expect(raw).toContain('Demo1234!'); // the real actions do carry it: this is what is being hidden
    const shown = JSON.stringify(seen.map((action) => sanitize(action)));
    for (const secret of ['Reg1ster!x', 'Demo1234!', 'Wrong-pass1!']) {
      expect(shown).not.toContain(secret);
    }
    expect(shown).toContain('[redacted]');
    expect(shown).not.toContain('[unsupported]'); // RTK Query actions are plain: nothing useful is hidden
  });
});
