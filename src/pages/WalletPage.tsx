import { Stack, Typography } from '@mui/material';

/** Placeholder: gives the `wallet` product a route until its screens are built. */
export function WalletPage() {
  return (
    <Stack spacing={2}>
      <Typography variant="h4" component="h1">
        Wallet
      </Typography>
      <Typography color="text.secondary">Balances and transfers will appear here.</Typography>
    </Stack>
  );
}
