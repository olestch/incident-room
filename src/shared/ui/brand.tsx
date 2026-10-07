export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`public-brand-mark ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M9 5h11M9 19h11M2 12h12M14 5v14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="14" cy="12" r="2.5" fill="currentColor" />
    </svg>
  );
}
export function SignalChannels() {
  return (
    <svg
      className="signal-channels"
      viewBox="0 0 720 520"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth="1">
        <path d="M0 100h240v160h480M100 0v180h320v340M0 420h160V320h420V80h140M0 260h720" />
        <path d="M240 0v520M580 0v520" strokeDasharray="3 9" opacity=".4" />
      </g>
      <g fill="currentColor">
        <circle cx="240" cy="100" r="5" />
        <circle cx="240" cy="260" r="8" />
        <circle cx="420" cy="180" r="5" />
        <circle cx="420" cy="320" r="5" />
        <circle cx="580" cy="260" r="8" />
        <circle cx="160" cy="420" r="5" />
      </g>
    </svg>
  );
}
