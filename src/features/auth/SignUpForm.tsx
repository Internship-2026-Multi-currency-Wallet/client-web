import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { useId } from 'react';
import { useAppForm } from '../../hooks/useAppForm';
import { PasswordChecklist } from './PasswordChecklist';
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
  const checklistId = `${passwordId}-requirements`;
  const showChecklist = isSubmitted || isFormSubmitting;
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
          type="password"
          {...registerInput('password')}
          autoComplete="new-password"
          required
          error={Boolean(errors.password)}
          helperText={passwordError}
          slotProps={{
            htmlInput: {
              'aria-describedby':
                [passwordError && `${passwordId}-helper-text`, showChecklist && checklistId]
                  .filter(Boolean)
                  .join(' ') || undefined,
            },
          }}
          disabled={isSubmitting}
        />
        {showChecklist && <PasswordChecklist id={checklistId} password={watch('password')} />}
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
