import { createTheme } from '@mui/material/styles';

import { brand } from '../brand/brand';

/** MUI theme built from the brand values of this build (`src/brand/brand.ts`). */
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: brand.palette.primary },
    secondary: { main: brand.palette.secondary },
    background: { default: brand.palette.background },
    text: { primary: brand.palette.text },
    success: { main: brand.palette.success },
    error: { main: brand.palette.error },
  },
  typography: { fontFamily: brand.fontFamily },
  shape: { borderRadius: 8 },
});
