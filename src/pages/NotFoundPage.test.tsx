import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/render';

describe('NotFoundPage', () => {
  it('is shown for unknown URLs and links back home', async () => {
    renderApp('/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Go home' }));
    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  });
});
