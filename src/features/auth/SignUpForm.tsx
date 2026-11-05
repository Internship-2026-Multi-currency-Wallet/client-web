import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import {
  type SignUpErrors,
  type SignUpInput,
  type SignUpValues,
  toSignUpInput,
  validateSignUp,
} from './validation';

export interface SignUpFormProps {
  /** Called with normalized values once validation passes. The owner talks to the API. */
  onSubmit: (input: SignUpInput) => void;
  isSubmitting?: boolean;
  /** The phone is mandatory (client setting `auth.phoneRequiredAt` = `signup`). Optional by default. */
  phoneRequired?: boolean;
  serverError?: string | null;
  /** Server-side errors for single fields (e.g. email already registered); the owner clears them in `onEdit`. */
  fieldErrors?: SignUpErrors;
  /** Called on every field edit, so the owner can drop the stale result of the previous submit. */
  onEdit?: () => void;
}

const EMPTY: SignUpValues = { email: '', password: '', phone: '' };

/**
 * Presentational form: no network, no routing. Errors appear after the first submit attempt,
 * then update on every change.
 */
export function SignUpForm({
  onSubmit,
  isSubmitting = false,
  phoneRequired = false,
  serverError,
  fieldErrors,
  onEdit,
}: SignUpFormProps) {
  const [values, setValues] = useState<SignUpValues>(EMPTY);
  const [errors, setErrors] = useState<SignUpErrors>({});
  const [attempted, setAttempted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const shown: SignUpErrors = { ...fieldErrors, ...errors };

  useEffect(() => {
    if (fieldErrors?.email) emailRef.current?.focus();
    else if (fieldErrors?.password) passwordRef.current?.focus();
    else if (fieldErrors?.phone) phoneRef.current?.focus();
  }, [fieldErrors]);

  const change =
    (field: keyof SignUpValues) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const next = { ...values, [field]: event.target.value };
      setValues(next);
      onEdit?.();
      if (attempted) setErrors(validateSignUp(next, { phoneRequired }));
    };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isSubmitting) return;
    const found = validateSignUp(values, { phoneRequired });
    setAttempted(true);
    setErrors(found);
    if (found.email) emailRef.current?.focus();
    else if (found.password) passwordRef.current?.focus();
    else if (found.phone) phoneRef.current?.focus();
    else onSubmit(toSignUpInput(values));
  };

  return (
    // noValidate: our messages replace the browser's native ones.
    <Box component="form" noValidate onSubmit={submit} aria-label="Sign up">
      <Stack spacing={2}>
        {serverError && <Alert severity="error">{serverError}</Alert>}
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={values.email}
          onChange={change('email')}
          error={Boolean(shown.email)}
          helperText={shown.email}
          disabled={isSubmitting}
          inputRef={emailRef}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={values.password}
          onChange={change('password')}
          error={Boolean(shown.password)}
          helperText={shown.password}
          disabled={isSubmitting}
          inputRef={passwordRef}
        />
        <TextField
          label={phoneRequired ? 'Phone' : 'Phone (optional)'}
          required={phoneRequired}
          type="tel"
          name="phone"
          autoComplete="tel"
          value={values.phone}
          onChange={change('phone')}
          error={Boolean(shown.phone)}
          helperText={shown.phone}
          disabled={isSubmitting}
          inputRef={phoneRef}
        />
        <Button type="submit" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Sign up'}
        </Button>
      </Stack>
    </Box>
  );
}
