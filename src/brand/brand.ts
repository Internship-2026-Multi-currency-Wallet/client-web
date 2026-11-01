/**
 * Brand values of this build. Every client branch has its own version of this file
 * and of the files in `public/brand/`; shared code must take brand values only from here.
 */
export const brand = {
  siteName: 'Demo Wallet',
  palette: {
    primary: '#4F46E5',
    secondary: '#0EA5E9',
    background: '#F8FAFC',
    text: '#1E1B4B',
    success: '#16A34A',
    error: '#DC2626',
  },
  fontFamily: 'Inter, "Segoe UI", Roboto, Arial, sans-serif',
  logoUrl: '/brand/logo.svg',
  faviconUrl: '/brand/favicon.svg',
} as const;
