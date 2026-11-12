import { Alert, Box, Button, Stack, TextField } from '@mui/material';
import { useAppForm } from '../../hooks/useAppForm';
import {
  type SignUpValues,
  type SignUpInput,
  type SignUpErrors,
  signUpSchema,
  toSignUpInput,
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
    formState: { errors },
    setError,
  } = useAppForm<SignUpValues>({
    schema: signUpSchema(phoneRequired),
    defaultValues: EMPTY,
  });

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
          label="Password"
          type="password"
          {...registerInput('password')}
          autoComplete="new-password"
          required
          error={Boolean(errors.password)}
          helperText={errors.password?.message}
          disabled={isSubmitting}
        />
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
