/**
 * Brand values of this build. Every client branch has its own version of this file
 * and of the files in `public/brand/`; shared code must take brand values only from here.
 */
export const brand = {
  siteName: 'Wisła Transfer',
  palette: {
    primary: '#0F766E',
    secondary: '#E11D48',
    background: '#F0FDFA',
    text: '#134E4A',
    success: '#16A34A',
    error: '#B91C1C',
  },
  fontFamily: 'Inter, "Segoe UI", Roboto, Arial, sans-serif',
  logoUrl: '/brand/logo.svg',
  faviconUrl: '/brand/favicon.svg',
} as const;
