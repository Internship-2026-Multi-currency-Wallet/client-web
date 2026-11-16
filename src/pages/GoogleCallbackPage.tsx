import { Typography } from '@mui/material';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { usePageTitle } from '../features/branding/usePageTitle';
import { postGoogleCallback } from '../features/auth/googlePopup';

export function GoogleCallbackPage() {
  usePageTitle('Google sign-in');
  const [params] = useSearchParams();

  useEffect(() => {
    const state = params.get('state');
    if (!state) return;
    postGoogleCallback({ state, code: params.get('code'), error: params.get('error') });
    window.close();
  }, [params]);

  return (
    <Typography sx={{ p: 4, textAlign: 'center' }}>
      Google sign-in finished. You can close this window.
    </Typography>
  );
}
