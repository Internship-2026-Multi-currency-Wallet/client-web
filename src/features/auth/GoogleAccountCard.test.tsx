import { render, screen } from '@testing-library/react';
import { HttpResponse } from 'msw';
import { AppProviders } from '../../app/AppProviders';
import { createStore } from '../../app/store';
import { server } from '../../mocks/server';
import { signInForTest } from '../../test/auth';
import { walletCore } from '../../test/graphql-handlers';
import { GoogleAccountCard } from './GoogleAccountCard';

describe('GoogleAccountCard', () => {
  it("never shows the previous user's link while the next user's one loads", async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    let calls = 0;
    server.use(
      walletCore.query('GoogleAccount', async () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({
            data: {
              googleAccount: { email: 'first@example.com', linkedAt: new Date().toISOString() },
            },
          });
        }
        await answered;
        return HttpResponse.json({ data: { googleAccount: null } });
      }),
    );
    signInForTest();
    const store = createStore();
    const card = (userId: string) => (
      <AppProviders store={store}>
        <GoogleAccountCard userId={userId} />
      </AppProviders>
    );
    const { rerender } = render(card('1'));
    expect(await screen.findByText('first@example.com')).toBeInTheDocument();

    rerender(card('2'));
    expect(await screen.findByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('first@example.com')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument();

    answer();
    expect(await screen.findByText(/^Not linked/)).toBeInTheDocument();
  });
});
