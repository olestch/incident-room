export const DEFAULT_DESTINATION = '/app/incidents';

/** Return exactly the safe input, including query/hash; never normalize an unsafe path into one. */
export function safeReturnDestination(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/app/'))
    return DEFAULT_DESTINATION;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\s\u0000-\u001f\u007f]/.test(value) || /[\\\u0000-\u001f\u007f]/.test(decoded))
      return DEFAULT_DESTINATION;
    const rawPath = value.split(/[?#]/)[0] ?? '';
    const decodedPath = decodeURIComponent(rawPath);
    if (
      decodedPath.split('/').some((part) => part === '.' || part === '..') ||
      /%2f|%5c|%25/i.test(rawPath) ||
      decodedPath.includes('//')
    )
      return DEFAULT_DESTINATION;
    const url = new URL(value, 'https://incident-room.example.test');
    if (url.origin !== 'https://incident-room.example.test' || !url.pathname.startsWith('/app/'))
      return DEFAULT_DESTINATION;
    return value;
  } catch {
    return DEFAULT_DESTINATION;
  }
}
