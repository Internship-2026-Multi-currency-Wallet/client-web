import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm, type SignUpFormProps } from './SignUpForm';

function setup(props: Partial<SignUpFormProps> = {}) {
  const onSubmit = vi.fn();
  render(<SignUpForm onSubmit={onSubmit} {...props} />);
  return {
    onSubmit,
    email: screen.getByLabelText(/^email/i),
    password: screen.getByLabelText(/^password/i),
    phone: screen.getByLabelText(/^phone/i),
    submit: screen.getByRole('button', { name: /sign up|creating account/i }),
  };
}

describe('SignUpForm', () => {
  it('submits normalized values', async () => {
    const { onSubmit, email, password, phone } = setup();
    await userEvent.type(email, ' USER@example.com ');
    await userEvent.type(password, 'Secret123!');
    await userEvent.type(phone, '+380501234567');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      email: 'user@example.com',
      password: 'Secret123!',
      phone: '+380501234567',
    });
  });

  it('treats the phone as optional', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.type(email, 'user@example.com');
    await userEvent.type(password, 'Secret123!');
    await userEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      email: 'user@example.com',
      password: 'Secret123!',
    });
  });

  it('shows accessible errors, focuses the first invalid field and does not submit', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(email).toBeInvalid();
    expect(email).toHaveAccessibleDescription('Enter your email');
    expect(password).toBeInvalid();
    expect(password).toHaveAccessibleDescription('Enter a password');
    expect(email).toHaveFocus();
  });

  it('rejects a malformed email and clears the error once fixed', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.type(email, 'not-an-email');
    await userEvent.type(password, 'Secret123!');
    await userEvent.click(submit);
    expect(email).toHaveAccessibleDescription('Enter a valid email address');

    await userEvent.clear(email);
    await userEvent.type(email, 'user@example.com');
    expect(email).toHaveAttribute('aria-invalid', 'false');
    expect(onSubmit).not.toHaveBeenCalled();

    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('does not show errors before the first submit attempt', async () => {
    const { email } = setup();
    await userEvent.type(email, 'x');
    expect(email).toHaveAttribute('aria-invalid', 'false');
  });

  it('disables the form while submitting', () => {
    const { email, password, phone, submit } = setup({ isSubmitting: true });
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent('Creating account…');
    for (const field of [email, password, phone]) expect(field).toBeDisabled();
  });

  it('shows a server error as an alert and keeps the typed values', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<SignUpForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/^email/i), 'user@example.com');

    rerender(<SignUpForm onSubmit={onSubmit} serverError="Something went wrong" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByLabelText(/^email/i)).toHaveValue('user@example.com');
  });

  it('focuses the password when only the password is invalid', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.type(email, 'user@example.com');
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(email).toHaveAttribute('aria-invalid', 'false');
    expect(password).toBeInvalid();
    expect(password).toHaveAccessibleDescription('Enter a password');
    expect(password).toHaveFocus();
  });

  it('keeps the values and allows a retry after a failed request (parent-controlled props)', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<SignUpForm onSubmit={onSubmit} />);
    const email = () => screen.getByLabelText(/^email/i);
    const password = () => screen.getByLabelText(/^password/i);
    const phone = () => screen.getByLabelText(/^phone/i);
    const button = () => screen.getByRole('button', { name: /sign up|creating account/i });

    await userEvent.type(email(), 'user@example.com');
    await userEvent.type(password(), 'Secret123!');
    await userEvent.type(phone(), '+380501234567');
    await userEvent.click(button());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender(<SignUpForm onSubmit={onSubmit} isSubmitting />);
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent('Creating account…');
    for (const field of [email(), password(), phone()]) expect(field).toBeDisabled();

    // The request fails: the parent re-enables the form and passes the error.
    rerender(<SignUpForm onSubmit={onSubmit} isSubmitting={false} serverError="Email is taken" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Email is taken');
    expect(button()).toBeEnabled();
    expect(email()).toBeEnabled();
    expect(email()).toHaveValue('user@example.com');
    expect(password()).toHaveValue('Secret123!');
    expect(phone()).toHaveValue('+380501234567');

    await userEvent.click(button());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith({
      email: 'user@example.com',
      password: 'Secret123!',
      phone: '+380501234567',
    });
  });

  it('calls onEdit on every field change but not on submit', async () => {
    const onEdit = vi.fn();
    const { email, password, phone, submit } = setup({ onEdit });
    await userEvent.type(email, 'ab');
    await userEvent.type(password, 'c');
    await userEvent.type(phone, 'd');
    expect(onEdit).toHaveBeenCalledTimes(4);

    await userEvent.click(submit);
    expect(onEdit).toHaveBeenCalledTimes(4);
  });

  it('rejects an email with an invalid domain', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.type(email, 'a@b..co');
    await userEvent.type(password, 'Secret123!');
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(email).toHaveAccessibleDescription('Enter a valid email address');
  });

  it('ignores a programmatic submit while submitting', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<SignUpForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/^email/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Secret123!');
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender(<SignUpForm onSubmit={onSubmit} isSubmitting />);
    // A disabled button cannot be clicked; submit the form directly (as Enter in a field would).
    fireEvent.submit(screen.getByRole('form', { name: 'Sign up' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('validates an optional phone only when it is given and focuses it', async () => {
    const { onSubmit, email, password, phone, submit } = setup();
    await userEvent.type(email, 'user@example.com');
    await userEvent.type(password, 'Secret123!');
    await userEvent.type(phone, '0501234567');
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(phone).toHaveAccessibleDescription('Use international format, e.g. +380501234567');
    expect(phone).toHaveFocus();
  });

  it('marks the phone required and refuses an empty one when phoneRequired', async () => {
    const { onSubmit, email, password, phone, submit } = setup({ phoneRequired: true });
    expect(phone).toBeRequired();
    expect(screen.queryByLabelText(/optional/i)).not.toBeInTheDocument();
    await userEvent.type(email, 'user@example.com');
    await userEvent.type(password, 'Secret123!');
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(phone).toHaveAccessibleDescription('Enter your phone number');
    expect(phone).toHaveFocus();
    await userEvent.type(phone, '+1234567');
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ phone: '+1234567' }));
  });

  it('labels the phone optional by default', () => {
    const { phone } = setup();
    expect(phone).not.toBeRequired();
    expect(screen.getByLabelText('Phone (optional)')).toBe(phone);
  });

  it('rejects a weak password with the rules hint', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.type(email, 'user@example.com');
    await userEvent.type(password, 'secret');
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(password).toHaveAccessibleDescription(/8-128 characters/);
    expect(password).toHaveFocus();
  });

  it('shows the field errors the submit resolves with, scrolls to and focuses the first one', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValue({ phone: 'Phone rejected', email: 'Email is taken' });
    const { email, password, phone, submit } = setup({ onSubmit });
    const scroll = vi.fn();
    email.scrollIntoView = scroll;
    await userEvent.type(email, 'user@example.com');
    await userEvent.type(password, 'Secret123!');
    await userEvent.type(phone, '+380501234567');
    await userEvent.click(submit);

    await waitFor(() => expect(email).toHaveAccessibleDescription('Email is taken'));
    expect(phone).toHaveAccessibleDescription('Phone rejected');
    await waitFor(() => expect(email).toHaveFocus());
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    expect(email).toHaveValue('user@example.com');
  });

  it('clears a server error only for the edited field and keeps client errors', async () => {
    const onSubmit = vi.fn().mockResolvedValueOnce({ email: 'Email is taken' });
    const { email, password, submit } = setup({ onSubmit });
    await userEvent.type(email, 'user@example.com');
    await userEvent.type(password, 'Secret123!');
    await userEvent.click(submit);
    await waitFor(() => expect(email).toHaveAccessibleDescription('Email is taken'));

    await userEvent.clear(password);
    expect(password).toHaveAccessibleDescription('Enter a password');
    expect(email).toHaveAccessibleDescription('Email is taken');

    await userEvent.type(email, 'x');
    expect(email).toHaveAttribute('aria-invalid', 'false');
    expect(password).toHaveAccessibleDescription('Enter a password');
  });

  it('retries after a server field error and applies the answer of the new attempt', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ email: 'Email is taken' })
      .mockResolvedValueOnce({ phone: 'Phone rejected' });
    const { email, password, phone, submit } = setup({ onSubmit });
    await userEvent.type(email, 'taken@example.com');
    await userEvent.type(password, 'Secret123!');
    await userEvent.type(phone, '+380501234567');
    await userEvent.click(submit);
    await waitFor(() => expect(email).toHaveAccessibleDescription('Email is taken'));

    await userEvent.clear(email);
    await userEvent.type(email, 'free@example.com');
    await userEvent.click(submit);

    await waitFor(() => expect(phone).toHaveAccessibleDescription('Phone rejected'));
    await waitFor(() => expect(phone).toHaveFocus());
    expect(email).toHaveAttribute('aria-invalid', 'false');
    expect(onSubmit).toHaveBeenLastCalledWith({
      email: 'free@example.com',
      password: 'Secret123!',
      phone: '+380501234567',
    });
  });
});
