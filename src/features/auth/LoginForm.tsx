import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import {
  type LoginErrors,
  type LoginInput,
  type LoginValues,
  toLoginInput,
  validateLogin,
} from './validation';

export interface LoginFormProps {
  /** Called with normalized values once validation passes. The owner talks to the API. */
  onSubmit: (input: LoginInput) => void;
  isSubmitting?: boolean;
  /** Ready-to-show message; the owner decides its text (wrong password, locked until…). */
  serverError?: string | null;
  /** Called on every field edit, so the owner can drop stale messages. */
  onEdit?: () => void;
}

const EMPTY: LoginValues = { email: '', password: '' };

/** Presentational form, same behavior as `SignUpForm`: errors after the first submit, then live. */
export function LoginForm({ onSubmit, isSubmitting = false, serverError, onEdit }: LoginFormProps) {
  const [values, setValues] = useState<LoginValues>(EMPTY);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [attempted, setAttempted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const change =
    (field: keyof LoginValues) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const next = { ...values, [field]: event.target.value };
      setValues(next);
      onEdit?.();
      if (attempted) setErrors(validateLogin(next));
    };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isSubmitting) return;
    const found = validateLogin(values);
    setAttempted(true);
    setErrors(found);
    if (found.email) emailRef.current?.focus();
    else if (found.password) passwordRef.current?.focus();
    else onSubmit(toLoginInput(values));
  };

  return (
    // noValidate: our messages replace the browser's native ones.
    <Box component="form" noValidate onSubmit={submit} aria-label="Log in">
      <Stack spacing={2}>
        {serverError && <Alert severity="error">{serverError}</Alert>}
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          required
          value={values.email}
          onChange={change('email')}
          error={Boolean(errors.email)}
          helperText={errors.email}
          disabled={isSubmitting}
          inputRef={emailRef}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={values.password}
          onChange={change('password')}
          error={Boolean(errors.password)}
          helperText={errors.password}
          disabled={isSubmitting}
          inputRef={passwordRef}
        />
        <Button type="submit" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in…' : 'Log in'}
        </Button>
      </Stack>
    </Box>
  );
}
