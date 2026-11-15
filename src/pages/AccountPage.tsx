import { Stack, Typography } from '@mui/material';
import { usePageTitle } from '../features/branding/usePageTitle';
import { GoogleAccountCard } from '../features/auth/GoogleAccountCard';

export function AccountPage() {
  usePageTitle('Account settings');

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Account settings
      </Typography>
      <GoogleAccountCard />
    </Stack>
  );
}
