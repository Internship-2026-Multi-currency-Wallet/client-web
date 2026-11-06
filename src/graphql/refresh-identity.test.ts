import { HttpResponse } from 'msw';
import { createStore } from '../app/store';
import { systemApi } from '../features/system/systemApi';
import { server } from '../mocks/server';
import {
  OTHER_USER,
  otherTab,
  signInForTest,
  storedRecord,
  TEST_USER,
  testSession,
} from '../test/auth';
import { walletCore } from '../test/graphql-handlers';
import { gate } from '../test/rotating-backend';
import { refreshSession } from './client';
import {
  clearSession,
  loadSession,
  onSessionChange,
  sessionGeneration,
  sessionWritesSettled,
} from './session';

/**
 * A refresh may renew the SAME user's session. It must never turn the session into another account's. The server
 * answers the refresh for whoever owns the cookie; if that is not the user of the session that asked, the answer is
 * refused and (if that session is still the current one) the session ends. Nothing newer is touched.
 */
function refreshAnswersFor(user: typeof TEST_USER, hold?: Promise<void>) {
  server.use(
    walletCore.mutation('RefreshSession', async () => {
      await hold;
      return HttpResponse.json({
        data: {
          refreshSession: {
            accessToken: `access-${user.id}-renewed`,
            accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            user,
          },
        },
      });
    }),
  );
}

function recordChanges() {
  const heard: (string | null)[] = [];
  const off = onSessionChange(({ session }) => heard.push(session?.user.id ?? null));
  return { heard, off };
}

describe('refresh and the identity of the session', () => {
  it('a refresh for the SAME user renews the session and keeps its generation', async () => {
    signInForTest({ expired: true, user: OTHER_USER });
    refreshAnswersFor(OTHER_USER);
    const generation = sessionGeneration();

    await expect(refreshSession()).resolves.toBe(true);

    expect(storedRecord().session?.accessToken).toBe('access-2-renewed');
    expect(storedRecord().session?.user.id).toBe(OTHER_USER.id);
    expect(sessionGeneration()).toBe(generation); // the same session
  });

  it('a refresh for ANOTHER user is refused: the session ends, the other identity and token are never stored or shown', async () => {
    signInForTest({ expired: true, user: OTHER_USER }); // the session of user 2 ...
    refreshAnswersFor(TEST_USER); // ... but the cookie answers for user 1
    const { heard, off } = recordChanges();

    await expect(refreshSession()).resolves.toBe(false);
    await sessionWritesSettled();

    expect(storedRecord().session).toBeNull();
    expect(loadSession()).toBeNull();
    expect(JSON.stringify(storedRecord())).not.toContain('access-1-renewed');
    expect(heard).toEqual([null]); // nobody was told about user 1
    off();
  });

  it('after a NEWER login the refusal changes nothing: the new session survives', async () => {
    signInForTest({ expired: true, user: OTHER_USER });
    const answer = gate();
    refreshAnswersFor(TEST_USER, answer.promise);
    const refreshing = refreshSession();
    const newer = { ...testSession(), accessToken: 'newer-login' };
    otherTab.login(newer); // another tab logs in meanwhile (a new generation)
    const written = JSON.stringify(storedRecord());

    answer.open(); // the answer for the OLD session, with the wrong user, arrives now
    await expect(refreshing).resolves.toBe(false);
    await sessionWritesSettled();

    expect(JSON.stringify(storedRecord())).toBe(written); // not cleared, not overwritten
    expect(storedRecord().session?.accessToken).toBe('newer-login');
  });

  it('after a Logout the refusal resurrects nothing', async () => {
    signInForTest({ expired: true, user: OTHER_USER });
    const answer = gate();
    refreshAnswersFor(TEST_USER, answer.promise);
    const { heard, off } = recordChanges();
    const refreshing = refreshSession();
    clearSession();

    answer.open();
    await expect(refreshing).resolves.toBe(false);
    await sessionWritesSettled();

    expect(loadSession()).toBeNull();
    expect(storedRecord().session).toBeNull();
    expect(heard).toEqual([null]); // only the logout itself was announced
    off();
  });

  it('the private cache of the old account is dropped and nothing of the other account reaches Redux', async () => {
    signInForTest({ user: OTHER_USER });
    const store = createStore();
    await store.dispatch(systemApi.endpoints.me.initiate());
    expect(systemApi.endpoints.me.select()(store.getState()).data?.id).toBe(OTHER_USER.id);
    refreshAnswersFor(TEST_USER);

    await expect(refreshSession()).resolves.toBe(false);

    expect(systemApi.endpoints.me.select()(store.getState()).data).toBeUndefined();
    expect(store.getState().auth).toMatchObject({ status: 'anonymous', user: null });
    expect(JSON.stringify(store.getState())).not.toContain(TEST_USER.email);
  });
});
