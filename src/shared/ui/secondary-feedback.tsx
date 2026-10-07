import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="secondary-empty">
      <span className="secondary-empty-icon">
        <Icon size={22} aria-hidden="true" />
      </span>
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}
export function RowSkeletons({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" className="secondary-loading">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div className="secondary-skeleton-row" key={index}>
            <span />
            <div>
              <span />
              <span />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
