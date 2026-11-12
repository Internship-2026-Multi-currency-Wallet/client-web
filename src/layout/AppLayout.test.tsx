import { screen, within } from '@testing-library/react';
import { brand } from '../brand/brand';
import { renderApp } from '../test/render';

describe('AppLayout', () => {
  it('shows the brand logo in the header', async () => {
    renderApp('/login');
    const header = within(await screen.findByRole('banner'));
    expect(header.getByRole('img', { name: brand.siteName })).toBeInTheDocument();
  });
});
