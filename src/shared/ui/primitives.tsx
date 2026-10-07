import type { ComponentProps } from 'react';
import { Info } from 'lucide-react';

export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'quiet' | 'danger' }) {
  return (
    <button type={type} className={`ui-button ui-button-${variant} ${className}`} {...props} />
  );
}

export function IconButton({
  label,
  className = '',
  ...props
}: ComponentProps<'button'> & { label: string }) {
  return (
    <Button
      variant="quiet"
      aria-label={label}
      title={label}
      className={`ui-icon-button ${className}`}
      {...props}
    />
  );
}

export function Badge({ children, className = '', ...props }: ComponentProps<'span'>) {
  return (
    <span className={`ui-badge ${className}`} {...props}>
      {children}
    </span>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return (
    <span className="ui-avatar" aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

export function InlineAlert({ children, className = '', ...props }: ComponentProps<'div'>) {
  return (
    <div className={`ui-alert ${className}`} role="alert" {...props}>
      <Info size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
