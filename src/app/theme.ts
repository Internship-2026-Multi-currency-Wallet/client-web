import { createTheme } from '@mui/material/styles';

/** Default ("demo") theme. Per-client branding is a later task. */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1565c0' },
    secondary: { main: '#00897b' },
  },
  shape: { borderRadius: 8 },
});
