/**
 * Brand values of this build. Every client branch has its own version of this file
 * and of the files in `public/brand/`; shared code must take brand values only from here.
 */
export const brand = {
  siteName: 'Kvitka Bank',
  palette: {
    primary: '#1E3A8A',
    secondary: '#F5B700',
    background: '#FFFDF5',
    text: '#0F172A',
    success: '#15803D',
    error: '#B91C1C',
  },
  fontFamily: 'Inter, "Segoe UI", Roboto, Arial, sans-serif',
  logoUrl: '/brand/logo.svg',
  faviconUrl: '/brand/favicon.svg',
} as const;
