import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Stack,
  SvgIcon,
  TextField,
} from '@mui/material';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useAppForm } from '../../hooks/useAppForm';
import { PasswordChecklist } from './PasswordChecklist';
import { PasswordStrength } from './PasswordStrength';
import {
  type SignUpValues,
  type SignUpInput,
  type SignUpErrors,
  signUpSchema,
  toSignUpInput,
  PASSWORD_HINT,
} from './validation';

export interface SignUpFormProps {
  /** Resolves with the server's errors for single fields (e.g. email already registered), if any. */
  onSubmit: (input: SignUpInput) => Promise<SignUpErrors | undefined>;
  isSubmitting?: boolean;
  /** The phone is mandatory (client setting `auth.phoneRequiredAt` = `signup`). Optional by default. */
  phoneRequired?: boolean;
  serverError?: string | null;
  onEdit?: () => void;
}

const EMPTY: SignUpValues = { email: '', password: '', phone: '' };

export function SignUpForm({
  onSubmit,
  isSubmitting = false,
  phoneRequired = false,
  serverError,
  onEdit,
}: SignUpFormProps) {
  const {
    registerInput,
    handleSubmit,
    formRef,
    formState: { errors, isSubmitted, isSubmitting: isFormSubmitting },
    watch,
    setError,
  } = useAppForm<SignUpValues>({
    schema: signUpSchema(phoneRequired),
    defaultValues: EMPTY,
  });
  const passwordId = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordSelection = useRef<[number, number, 'forward' | 'backward' | 'none'] | null>(null);
  useLayoutEffect(() => {
    if (!passwordSelection.current) return;
    const input = formRef.current?.querySelector<HTMLInputElement>('input[name="password"]');
    input?.focus();
    input?.setSelectionRange(...passwordSelection.current);
    passwordSelection.current = null;
  }, [passwordVisible, formRef]);

  const togglePasswordVisibility = () => {
    const input = formRef.current?.querySelector<HTMLInputElement>('input[name="password"]');
    if (!input) return;
    passwordSelection.current = [
      input.selectionStart ?? 0,
      input.selectionEnd ?? 0,
      input.selectionDirection ?? 'none',
    ];
    setPasswordVisible((visible) => !visible);
  };
  const checklistId = `${passwordId}-requirements`;
  const strengthId = `${passwordId}-strength`;
  const showChecklist = isSubmitted || isFormSubmitting;
  const password = watch('password');
  const showStrength = showChecklist && password !== '';
  const passwordError =
    errors.password?.type !== 'server' && errors.password?.message === PASSWORD_HINT
      ? 'Meet all password requirements below'
      : errors.password?.message;

  // A field's server error goes away when that field is edited: RHF re-validates it after a submit.
  const submit = async (values: SignUpValues) => {
    const fieldErrors = await onSubmit(toSignUpInput(values));
    for (const [field, message] of Object.entries(fieldErrors ?? {})) {
      if (message) setError(field as keyof SignUpValues, { type: 'server', message });
    }
  };

  return (
    // noValidate: our messages replace the browser's native ones.
    <Box
      component="form"
      noValidate
      ref={formRef}
      onChange={onEdit}
      onSubmit={isSubmitting ? (event) => event.preventDefault() : handleSubmit(submit)}
      aria-label="Sign up"
    >
      <Stack spacing={2}>
        {serverError && <Alert severity="error">{serverError}</Alert>}
        <TextField
          label="Email"
          type="email"
          {...registerInput('email')}
          autoComplete="email"
          required
          error={Boolean(errors.email)}
          helperText={errors.email?.message}
          disabled={isSubmitting}
        />
        <TextField
          id={passwordId}
          label="Password"
          type={passwordVisible ? 'text' : 'password'}
          {...registerInput('password')}
          autoComplete="new-password"
          required
          error={Boolean(errors.password)}
          helperText={passwordError}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    type="button"
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={togglePasswordVisibility}
                    disabled={isSubmitting}
                    edge="end"
                  >
                    <SvgIcon>
                      <path
                        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      {passwordVisible && (
                        <path d="m3 3 18 18" stroke="currentColor" strokeWidth="2" />
                      )}
                    </SvgIcon>
                  </IconButton>
                </InputAdornment>
              ),
            },
            htmlInput: {
              'aria-describedby':
                [
                  passwordError && `${passwordId}-helper-text`,
                  showChecklist && checklistId,
                  showStrength && strengthId,
                ]
                  .filter(Boolean)
                  .join(' ') || undefined,
            },
          }}
          disabled={isSubmitting}
        />
        {showChecklist && <PasswordChecklist id={checklistId} password={password} />}
        {showStrength && <PasswordStrength id={strengthId} password={password} />}
        <TextField
          label={phoneRequired ? 'Phone' : 'Phone (optional)'}
          required={phoneRequired}
          type="tel"
          {...registerInput('phone')}
          autoComplete="tel"
          error={Boolean(errors.phone)}
          helperText={errors.phone?.message}
          disabled={isSubmitting}
        />
        <Button type="submit" variant="contained" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Sign up'}
        </Button>
      </Stack>
    </Box>
  );
}
