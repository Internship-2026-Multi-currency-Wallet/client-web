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
  TextField,
  Typography,
} from '@mui/material';
import { type FormEvent, useState } from 'react';
import { describeGoogleLinkError } from './authErrors';
import {
  useGoogleAccountQuery,
  useGoogleLink,
  useGoogleSignInEnabled,
  useUnlinkGoogleAccountMutation,
} from './googleApi';

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));

export function GoogleAccountCard({ userId }: { userId: string }) {
  const enabled = useGoogleSignInEnabled();
  const account = useGoogleAccountQuery(userId);
  const link = useGoogleLink(userId);
  const [unlink, unlinking] = useUnlinkGoogleAccountMutation();
  const [confirming, setConfirming] = useState(false);
  const [askingPassword, setAskingPassword] = useState(false);
  const [password, setPassword] = useState('');
  // `currentData`, not `data`: `data` keeps the previous user's answer while this user's one loads.
  const linked = account.currentData;
  const busy = link.isPending || unlinking.isLoading || account.isFetching;

  const closePasswordDialog = () => {
    setAskingPassword(false);
    setPassword('');
  };

  // Straight from the submit, before any `await`: the Google window must open in response to the user.
  const startLink = (event: FormEvent) => {
    event.preventDefault();
    closePasswordDialog();
    unlinking.reset();
    link.start(password);
  };

  const confirmUnlink = () => {
    setConfirming(false);
    link.reset();
    void unlink(userId);
  };

  return (
    <Card component="section" aria-labelledby="google-account-heading">
      <CardContent>
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Typography id="google-account-heading" variant="h6" component="h2">
            Google sign-in
          </Typography>

          {linked === undefined && account.isFetching && (
            <Typography role="status">Loading…</Typography>
          )}
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

          {linked && (
            <Typography>
              Linked to <strong>{linked.email}</strong> since {formatDate(linked.linkedAt)}.
            </Typography>
          )}
          {linked === null && (
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

          {linked === null && enabled && (
            <Button variant="contained" onClick={() => setAskingPassword(true)} disabled={busy}>
              {link.isPending ? 'Waiting for Google…' : 'Link Google account'}
            </Button>
          )}
          {link.isPending && link.popupClosed && (
            <Typography role="status" variant="body2">
              Closed the Google window? Cancel to try again.
            </Typography>
          )}
          {link.isPending && (
            <Button size="small" onClick={link.cancel}>
              Cancel
            </Button>
          )}
          {linked && (
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

      <Dialog
        open={askingPassword}
        onClose={closePasswordDialog}
        slotProps={{ paper: { component: 'form', onSubmit: startLink } }}
      >
        <DialogTitle>Link Google account</DialogTitle>
        <DialogContent>
          <DialogContentText>Enter your password to continue to Google.</DialogContentText>
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            fullWidth
            margin="dense"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closePasswordDialog}>Cancel</Button>
          <Button type="submit" disabled={!password}>
            Continue
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirming} onClose={() => setConfirming(false)}>
        <DialogTitle>Unlink Google account?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You will no longer be able to log in with {linked?.email}. You will also be logged out
            on your other devices.
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
