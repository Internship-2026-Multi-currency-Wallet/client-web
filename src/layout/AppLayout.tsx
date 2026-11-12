import { AppBar, Box, Button, Chip, Container, Toolbar, Typography } from '@mui/material';
import { Link as RouterLink, Outlet } from 'react-router';
import { useAppSelector } from '../app/store';
import { config } from '../config-env';
import { selectUser } from '../features/auth/authSlice';
import { useLogout } from '../features/auth/useLogout';
import { Logo } from '../features/branding/Logo';

export interface MenuItem {
  path: string;
  label: string;
}

export function AppLayout({ menuItems }: { menuItems: MenuItem[] }) {
  const user = useAppSelector(selectUser);
  const logout = useLogout();

  return (
    <Box sx={{ minHeight: '100vh' }}>
      <AppBar position="static" color="inherit">
        <Toolbar>
          <Box sx={{ flexGrow: 1 }}>
            <Logo />
          </Box>
          {config.useMocks && <Chip label="mocks" color="warning" size="small" sx={{ mr: 1 }} />}
          <Chip label={`client: ${config.client}`} size="small" sx={{ mr: 2, color: 'inherit' }} />
          {menuItems.map(({ path, label }) => (
            <Button key={path} color="inherit" component={RouterLink} to={path}>
              {label}
            </Button>
          ))}
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
