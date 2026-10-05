'use client';
import { useRef, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { AppError } from '@/shared/errors/app-error';
import { loginSchema, registrationSchema, resetSchema } from './auth-schemas';

export type AuthMode = 'login' | 'register' | 'forgot-password';
export interface AuthValues {
  name: string;
  email: string;
  password: string;
  confirmation: string;
}
const titles = {
  login: 'Sign in',
  register: 'Create an account',
  'forgot-password': 'Request password reset',
};
function resolver(mode: AuthMode): Resolver<AuthValues> {
  return (values) => {
    const schema =
      mode === 'login' ? loginSchema : mode === 'register' ? registrationSchema : resetSchema;
    const result = schema.safeParse(values);
    if (result.success) return { values: { ...values, ...result.data }, errors: {} };
    const errors: Partial<Record<keyof AuthValues, { type: string; message: string }>> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (field === 'name' || field === 'email' || field === 'password' || field === 'confirmation')
        errors[field] ??= { type: 'validation', message: issue.message };
    }
    return { values: {}, errors };
  };
}
export function AuthForm({
  mode,
  submit,
}: {
  mode: AuthMode;
  submit(values: AuthValues): Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<AuthValues>({
    resolver: resolver(mode),
    defaultValues: { name: '', email: '', password: '', confirmation: '' },
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const pending = useRef(false);
  const fields: { name: keyof AuthValues; label: string; type: string; autocomplete: string }[] = [
    ...(mode === 'register'
      ? [{ name: 'name' as const, label: 'Display name', type: 'text', autocomplete: 'name' }]
      : []),
    {
      name: 'email',
      label: 'Email',
      type: 'email',
      autocomplete: mode === 'login' ? 'username' : 'email',
    },
    ...(mode !== 'forgot-password'
      ? [
          {
            name: 'password' as const,
            label: 'Password',
            type: 'password',
            autocomplete: mode === 'login' ? 'current-password' : 'new-password',
          },
        ]
      : []),
    ...(mode === 'register'
      ? [
          {
            name: 'confirmation' as const,
            label: 'Confirm password',
            type: 'password',
            autocomplete: 'new-password',
          },
        ]
      : []),
  ];
  if (confirmed)
    return (
      <p role="status" className="rounded-lg border border-line p-4">
        If an account exists for this email, reset instructions have been requested. No real email
        is sent in this demo.
      </p>
    );
  return (
    <form
      noValidate
      aria-label={titles[mode]}
      aria-busy={isSubmitting}
      className="space-y-5"
      onSubmit={(event) => {
        void handleSubmit(async (values) => {
          if (pending.current) return;
          pending.current = true;
          setFailure(null);
          try {
            await submit(values);
            if (mode === 'forgot-password') setConfirmed(true);
          } catch (error) {
            setFailure(
              error instanceof AppError
                ? error.message
                : 'Unable to complete this request. Please try again.',
            );
            // Passwords remain local form input only and are cleared after every submitted attempt.
          } finally {
            resetField('password');
            resetField('confirmation');
            pending.current = false;
          }
          requestAnimationFrame(() => errorRef.current?.focus());
        })(event);
      }}
    >
      {fields.map((field) => (
        <div key={field.name}>
          <label className="mb-2 block font-medium" htmlFor={field.name}>
            {field.label}
          </label>
          <input
            {...register(field.name)}
            id={field.name}
            type={field.type}
            autoComplete={field.autocomplete}
            maxLength={field.name === 'name' ? 80 : field.name === 'email' ? 254 : 128}
            aria-invalid={Boolean(errors[field.name])}
            aria-describedby={errors[field.name] ? `${field.name}-error` : undefined}
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 py-2"
          />
          {errors[field.name] && (
            <p id={`${field.name}-error`} className="mt-2 text-sm text-critical">
              {errors[field.name]?.message}
            </p>
          )}
        </div>
      ))}
      {failure && (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-critical p-3 text-critical"
        >
          {failure}
        </p>
      )}
      <button
        type="submit"
        disabled={isSubmitting}
        className="min-h-11 w-full rounded-lg bg-ink px-4 py-3 font-semibold text-white disabled:opacity-60"
      >
        {isSubmitting ? 'Please wait…' : titles[mode]}
      </button>
      <p role="status" className="text-sm text-muted">
        {isSubmitting ? 'Submitting your request.' : ''}
      </p>
    </form>
  );
}
