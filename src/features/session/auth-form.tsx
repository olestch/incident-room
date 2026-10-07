'use client';
import { useRef, useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { AppError } from '@/shared/errors/app-error';
import { Eye, EyeOff } from 'lucide-react';
import { Button, InlineAlert } from '@/shared/ui/primitives';
import { DEMO_ACCOUNT } from './demo-account';
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
    setValue,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<AuthValues>({
    resolver: resolver(mode),
    defaultValues: { name: '', email: '', password: '', confirmation: '' },
  });
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Partial<Record<keyof AuthValues, boolean>>>({});
  const [demoFilled, setDemoFilled] = useState(false);
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
      <p role="status" className="auth-recovery-result">
        If an account exists for this email, reset instructions have been requested. No real email
        is sent in this demo.
      </p>
    );
  return (
    <form
      noValidate
      aria-label={titles[mode]}
      aria-busy={isSubmitting}
      className="auth-form"
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
            setVisible({});
            setDemoFilled(false);
            pending.current = false;
          }
          requestAnimationFrame(() => errorRef.current?.focus());
        })(event);
      }}
    >
      {fields.map((field) => (
        <div key={field.name}>
          <label className="auth-field-label" htmlFor={field.name}>
            {field.label}
          </label>
          <div className="auth-input-wrap">
            <input
              {...register(field.name)}
              id={field.name}
              type={field.type === 'password' && visible[field.name] ? 'text' : field.type}
              autoComplete={field.autocomplete}
              maxLength={field.name === 'name' ? 80 : field.name === 'email' ? 254 : 128}
              aria-invalid={Boolean(errors[field.name])}
              aria-describedby={errors[field.name] ? `${field.name}-error` : undefined}
              className={`auth-input ${field.type === 'password' ? 'auth-password-input' : ''}`}
            />
            {field.type === 'password' && (
              <Button
                variant="quiet"
                className="auth-password-toggle"
                aria-label={`${visible[field.name] ? 'Hide' : 'Show'} ${field.name === 'confirmation' ? 'password confirmation' : 'password'}`}
                aria-controls={field.name}
                aria-pressed={Boolean(visible[field.name])}
                onClick={() =>
                  setVisible((current) => ({ ...current, [field.name]: !current[field.name] }))
                }
              >
                {visible[field.name] ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
          {errors[field.name] && (
            <p id={`${field.name}-error`} className="mt-2 text-sm text-critical">
              {errors[field.name]?.message}
            </p>
          )}
        </div>
      ))}
      {failure && (
        <InlineAlert ref={errorRef} tabIndex={-1}>
          {failure}
        </InlineAlert>
      )}
      <Button variant="primary" type="submit" disabled={isSubmitting} className="auth-submit">
        {isSubmitting ? 'Please wait…' : titles[mode]}
      </Button>
      <p role="status" className="auth-submit-status">
        {isSubmitting
          ? 'Submitting your request.'
          : demoFilled
            ? 'Demo credentials filled. Select Sign in to continue.'
            : ''}
      </p>
      {mode === 'login' && (
        <div className="auth-demo-account">
          <div className="auth-demo-heading">
            <strong>Demo account</strong>
            <span>Fictional</span>
          </div>
          <dl>
            <div>
              <dt>Email</dt>
              <dd>{DEMO_ACCOUNT.email}</dd>
            </div>
            <div>
              <dt>Password</dt>
              <dd>{DEMO_ACCOUNT.password}</dd>
            </div>
          </dl>
          <Button
            className="auth-demo-fill"
            disabled={isSubmitting}
            onClick={() => {
              setValue('email', DEMO_ACCOUNT.email, { shouldDirty: true, shouldValidate: true });
              setValue('password', DEMO_ACCOUNT.password, {
                shouldDirty: true,
                shouldValidate: true,
              });
              setFailure(null);
              setDemoFilled(true);
              setFocus('password');
            }}
          >
            Use demo account
          </Button>
          <p>Fills the form. Sign in when you’re ready.</p>
        </div>
      )}
    </form>
  );
}
