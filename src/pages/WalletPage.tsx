import { Stack, Typography } from '@mui/material';
import { usePageTitle } from '../features/branding/usePageTitle';

/** Placeholder: gives the `wallet` product a route until its screens are built. */
export function WalletPage() {
  usePageTitle('Wallet');
  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        Wallet
      </Typography>
      <Typography color="text.secondary">Balances and transfers will appear here.</Typography>
    </Stack>
  );
}
