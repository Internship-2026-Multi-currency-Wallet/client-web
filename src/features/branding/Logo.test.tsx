import { render, screen } from '@testing-library/react';
import { brand } from '../../brand/brand';
import { Logo } from './Logo';

describe('Logo', () => {
  it('shows the brand logo named after the site', () => {
    render(<Logo />);
    expect(screen.getByRole('img', { name: brand.siteName })).toHaveAttribute('src', brand.logoUrl);
  });

  it('uses the height prop for the image height', () => {
    render(<Logo height={48} />);
    expect(screen.getByRole('img', { name: brand.siteName })).toHaveStyle({ height: '48px' });
  });
});
