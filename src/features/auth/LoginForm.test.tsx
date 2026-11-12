import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm, type LoginFormProps } from './LoginForm';

function setup(props: Partial<LoginFormProps> = {}) {
  const onSubmit = vi.fn();
  render(<LoginForm onSubmit={onSubmit} {...props} />);
  return {
    onSubmit,
    email: screen.getByLabelText(/^email/i),
    password: screen.getByLabelText(/^password/i),
    submit: screen.getByRole('button', { name: /log in|logging in/i }),
  };
}

describe('LoginForm', () => {
  it('submits the trimmed email and the password exactly as typed', async () => {
    const { onSubmit, email, password } = setup();
    await userEvent.type(email, ' USER@example.com ');
    await userEvent.type(password, '  secret  ');
    await userEvent.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({
      email: 'user@example.com',
      password: '  secret  ',
    });
  });

  it('uses login autocomplete hints and has no sign-up fields', () => {
    const { email, password } = setup();
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByLabelText(/phone/i)).not.toBeInTheDocument();
  });

  it('requires email and password, focuses the email and does not submit', async () => {
    const { onSubmit, email, password, submit } = setup();
    const scroll = vi.fn();
    email.scrollIntoView = scroll;
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(email).toBeInvalid();
    expect(email).toHaveAccessibleDescription('Enter your email');
    expect(password).toBeInvalid();
    expect(password).toHaveAccessibleDescription('Enter a password');
    expect(email).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
  });

  it('focuses the password when only the password is missing', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.type(email, 'user@example.com');
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(email).toHaveAttribute('aria-invalid', 'false');
    expect(password).toHaveAccessibleDescription('Enter a password');
    expect(password).toHaveFocus();
  });

  it('rejects a malformed email, then updates the error while the user edits', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.type(email, 'not-an-email');
    await userEvent.type(password, 'secret');
    await userEvent.click(submit);
    expect(email).toHaveAccessibleDescription('Enter a valid email address');

    await userEvent.clear(email);
    expect(email).toHaveAccessibleDescription('Enter your email');
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

  it('calls onEdit on every field change but not on submit', async () => {
    const onEdit = vi.fn();
    const { email, password, submit } = setup({ onEdit });
    await userEvent.type(email, 'ab');
    await userEvent.type(password, 'c');
    expect(onEdit).toHaveBeenCalledTimes(3);

    await userEvent.click(submit);
    expect(onEdit).toHaveBeenCalledTimes(3);
  });

  it('disables the form while submitting', () => {
    const { email, password, submit } = setup({ isSubmitting: true });
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent('Logging in…');
    expect(email).toBeDisabled();
    expect(password).toBeDisabled();
  });

  it('keeps the values and allows a retry after the parent shows a server error', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<LoginForm onSubmit={onSubmit} />);
    const email = () => screen.getByLabelText(/^email/i);
    const password = () => screen.getByLabelText(/^password/i);
    const button = () => screen.getByRole('button', { name: /log in|logging in/i });

    await userEvent.type(email(), 'user@example.com');
    await userEvent.type(password(), 'secret');
    await userEvent.click(button());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender(<LoginForm onSubmit={onSubmit} isSubmitting />);
    expect(button()).toBeDisabled();

    rerender(<LoginForm onSubmit={onSubmit} isSubmitting={false} serverError="Login failed" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Login failed');
    expect(button()).toBeEnabled();
    expect(email()).toHaveValue('user@example.com');
    expect(password()).toHaveValue('secret');

    await userEvent.click(button());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('rejects an email with an invalid domain', async () => {
    const { onSubmit, email, password, submit } = setup();
    await userEvent.type(email, 'om@,.l');
    await userEvent.type(password, 'secret');
    await userEvent.click(submit);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(email).toHaveAccessibleDescription('Enter a valid email address');
  });

  it('ignores a programmatic submit while submitting', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<LoginForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/^email/i), 'user@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    rerender(<LoginForm onSubmit={onSubmit} isSubmitting />);
    // A disabled button cannot be clicked; submit the form directly (as Enter in a field would).
    fireEvent.submit(screen.getByRole('form', { name: 'Log in' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
