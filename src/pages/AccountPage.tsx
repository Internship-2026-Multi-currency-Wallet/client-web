import { Stack, Typography } from '@mui/material';
import { useAppSelector } from '../app/store';
import { selectUser } from '../features/auth/authSlice';
import { usePageTitle } from '../features/branding/usePageTitle';
import { GoogleAccountCard } from '../features/auth/GoogleAccountCard';
import { useClientSetting } from '../features/settings/useClientSetting';

export function AccountPage() {
  usePageTitle('Account settings');
  const user = useAppSelector(selectUser);
  const googleLogin = useClientSetting('auth.googleLogin');
  if (!user) return null;

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        Account settings
      </Typography>
      {googleLogin && <GoogleAccountCard key={user.id} userId={user.id} />}
    </Stack>
  );
}
