import { brand } from '../brand/brand';
import { theme } from './theme';

describe('theme', () => {
  it.each([
    ['primary.main', () => theme.palette.primary.main, brand.palette.primary],
    ['secondary.main', () => theme.palette.secondary.main, brand.palette.secondary],
    ['background.default', () => theme.palette.background.default, brand.palette.background],
    ['text.primary', () => theme.palette.text.primary, brand.palette.text],
    ['success.main', () => theme.palette.success.main, brand.palette.success],
    ['error.main', () => theme.palette.error.main, brand.palette.error],
  ])('takes palette.%s from the brand', (_slot, actual, expected) => {
    expect(actual()).toBe(expected);
  });

  it('takes the font family from the brand', () => {
    expect(theme.typography.fontFamily).toBe(brand.fontFamily);
  });
});
