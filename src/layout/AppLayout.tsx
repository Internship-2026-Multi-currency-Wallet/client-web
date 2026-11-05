import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Outlet } from 'react-router';
import { useAppSelector } from '../app/store';
import { config } from '../config-env';
import { selectUser } from '../features/auth/authSlice';
import { useLogout } from '../features/auth/useLogout';

export function AppLayout() {
  const user = useAppSelector(selectUser);
  const logout = useLogout();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Wallet
          </Typography>
          {config.useMocks && <Chip label="mocks" color="warning" size="small" sx={{ mr: 1 }} />}
          <Chip label={`client: ${config.client}`} size="small" sx={{ mr: 2, color: 'inherit' }} />
          <Button color="inherit" component={RouterLink} to="/">
            Home
          </Button>
          {user && (
            <>
              <Typography variant="body2" sx={{ mx: 2 }}>
                {user.email}
              </Typography>
              <Button color="inherit" onClick={() => void logout()}>
                Log out
              </Button>
            </>
          )}
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
