import { Typography } from '@mui/material';
import { useEffect } from 'react';
import { usePageTitle } from '../features/branding/usePageTitle';
import { postGoogleCallback } from '../features/auth/googlePopup';

export function GoogleCallbackPage() {
  usePageTitle('Google sign-in');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const state = params.get('state');
    if (!state) return;
    postGoogleCallback({ state, code: params.get('code'), error: params.get('error') });
    window.close();
    // The code is single-use, but it has no business staying in the address bar or the history.
    history.replaceState(null, '', location.pathname);
  }, []);

  return (
    <Typography sx={{ p: 4, textAlign: 'center' }}>
      Google sign-in finished. You can close this window.
    </Typography>
  );
}
