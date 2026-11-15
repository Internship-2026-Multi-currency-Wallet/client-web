import {
  Alert,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { describeGoogleLinkError } from './authErrors';
import {
  useGoogleAccountQuery,
  useGoogleLink,
  useGoogleSignInEnabled,
  useUnlinkGoogleAccountMutation,
} from './googleApi';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));

/** Whether a Google account is linked, with Link and Unlink. */
export function GoogleAccountCard() {
  const enabled = useGoogleSignInEnabled();
  const account = useGoogleAccountQuery();
  const link = useGoogleLink();
  const [unlink, unlinking] = useUnlinkGoogleAccountMutation();
  const [confirming, setConfirming] = useState(false);
  const busy = link.isPending || unlinking.isLoading || account.isFetching;

  const startLink = () => {
    unlinking.reset();
    link.start();
  };

  const confirmUnlink = () => {
    setConfirming(false);
    link.reset();
    void unlink();
  };

  return (
    <Card component="section" aria-labelledby="google-account-heading">
      <CardContent>
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography id="google-account-heading" variant="h6" component="h2">
            Google sign-in
          </Typography>

          {account.isLoading && <Typography role="status">Loading…</Typography>}
          {account.error && (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => void account.refetch()}>
                  Retry
                </Button>
              }
            >
              Could not load your Google sign-in. Please try again.
            </Alert>
          )}

          {account.data && (
            <Typography>
              Linked to <strong>{account.data.email}</strong> since{' '}
              {formatDate(account.data.linkedAt)}.
            </Typography>
          )}
          {account.data === null && (
            <Typography>
              {enabled
                ? 'Not linked. Link a Google account to log in with it.'
                : 'Not linked. Sign-in with Google is not available.'}
            </Typography>
          )}

          {link.error && <Alert severity="error">{describeGoogleLinkError(link.error)}</Alert>}
          {unlinking.error && (
            <Alert severity="error">Could not unlink the Google account. Please try again.</Alert>
          )}

          {account.data === null && enabled && (
            <Button variant="contained" onClick={startLink} disabled={busy}>
              {link.isPending ? 'Waiting for Google…' : 'Link Google account'}
            </Button>
          )}
          {account.data && (
            <Button
              variant="outlined"
              color="error"
              onClick={() => setConfirming(true)}
              disabled={busy}
            >
              {unlinking.isLoading ? 'Unlinking…' : 'Unlink'}
            </Button>
          )}
        </Stack>
      </CardContent>

      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>Unlink Google account?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You will no longer be able to log in with {account.data?.email}. You will also be logged
            out on your other devices.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button color="error" onClick={confirmUnlink}>
            Unlink
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
