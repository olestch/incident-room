import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AppError } from '@/shared/errors/app-error';
import { AuthForm } from './auth-form';

it('validates login fields, associates errors and focuses the first invalid field', async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  render(<AuthForm mode="login" submit={submit} />);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
    'Enter a valid email address.',
  );
  await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus());
  expect(submit).not.toHaveBeenCalled();
});
it('announces failed login with focus, preserves email and clears submitted password', async () => {
  const user = userEvent.setup();
  render(
    <AuthForm
      mode="login"
      submit={async () => {
        throw new AppError('authentication', 'Email or password is incorrect.');
      }}
    />,
  );
  await user.type(screen.getByLabelText('Email'), 'river.vale@example.test');
  await user.type(screen.getByLabelText('Password'), 'Wrong-fictional');
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  expect(screen.getByLabelText('Email')).toHaveValue('river.vale@example.test');
  expect(screen.getByLabelText('Password')).toHaveValue('');
});
it('normalizes successful login and prevents duplicate submission while announcing pending state', async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const submit = vi.fn(() => gate);
  render(<AuthForm mode="login" submit={submit} />);
  await user.type(screen.getByLabelText('Email'), 'RIVER.VALE@example.test');
  await user.type(screen.getByLabelText('Password'), 'Fictional-pass-42');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
  expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'true');
  await user.keyboard('{Enter}');
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ email: 'river.vale@example.test' }),
  );
  finish();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled());
});
it('validates registration display name, password length and confirmation', async () => {
  const user = userEvent.setup();
  const submit = vi.fn();
  render(<AuthForm mode="register" submit={submit} />);
  await user.type(screen.getByLabelText('Email'), 'nova.reed@example.test');
  await user.type(screen.getByLabelText('Password', { exact: true }), 'short');
  await user.type(screen.getByLabelText('Confirm password'), 'different');
  await user.click(screen.getByRole('button', { name: 'Create an account' }));
  expect(screen.getByText('Enter your display name.')).toBeVisible();
  expect(screen.getByText('Use at least 10 characters.')).toBeVisible();
  expect(screen.getByText('Passwords must match.')).toBeVisible();
  expect(submit).not.toHaveBeenCalled();
});
it('shows generic recovery success without confirming account existence', async () => {
  const user = userEvent.setup();
  const submit = vi.fn(async () => {});
  render(<AuthForm mode="forgot-password" submit={submit} />);
  await user.type(screen.getByLabelText('Email'), 'unknown@example.test');
  await user.click(screen.getByRole('button', { name: 'Request password reset' }));
  expect(await screen.findByRole('status')).toHaveTextContent('If an account exists');
  expect(submit).toHaveBeenCalledTimes(1);
});
it('shows a safe retryable service failure without raw exception output', async () => {
  const user = userEvent.setup();
  render(
    <AuthForm
      mode="forgot-password"
      submit={async () => {
        throw new Error('secret raw payload');
      }}
    />,
  );
  await user.type(screen.getByLabelText('Email'), 'unknown@example.test');
  await user.click(screen.getByRole('button', { name: 'Request password reset' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Unable to complete this request. Please try again.',
  );
  expect(screen.queryByText('secret raw payload')).not.toBeInTheDocument();
});
