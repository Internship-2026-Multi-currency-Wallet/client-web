import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { useAppForm } from '../../hooks/useAppForm';
import { type LoginValues, type LoginInput, loginSchema, toLoginInput } from './validation';

export interface LoginFormProps {
  onSubmit: (input: LoginInput) => void;
  isSubmitting?: boolean;
  /** Ready-to-show message; the owner decides its text (wrong password, locked until…). */
  serverError?: string | null;
  onEdit?: () => void;
}

const EMPTY: LoginValues = { email: '', password: '' };

export function LoginForm({ onSubmit, isSubmitting = false, serverError, onEdit }: LoginFormProps) {
  const {
    registerInput,
    handleSubmit,
    formRef,
    formState: { errors },
  } = useAppForm<LoginValues>({
    schema: loginSchema,
    defaultValues: EMPTY,
  });

  return (
    // noValidate: our messages replace the browser's native ones.
    <Box
      component="form"
      noValidate
      ref={formRef}
      onChange={onEdit}
      onSubmit={
        isSubmitting
          ? (event) => event.preventDefault()
          : handleSubmit((values) => onSubmit(toLoginInput(values)))
      }
      aria-label="Log in"
    >
      <Stack spacing={2}>
        {serverError && <Alert severity="error">{serverError}</Alert>}
        <TextField
          label="Email"
          type="email"
          {...registerInput('email')}
          autoComplete="username"
          required
          error={Boolean(errors.email)}
          helperText={errors.email?.message}
          disabled={isSubmitting}
        />
        <TextField
          label="Password"
          type="password"
          {...registerInput('password')}
          autoComplete="current-password"
          required
          error={Boolean(errors.password)}
          helperText={errors.password?.message}
          disabled={isSubmitting}
        />
        <Button type="submit" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
      </Stack>
    </Box>
  );
}
