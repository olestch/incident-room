export interface ThreadLocation {
  root: string | null;
  message: string | null;
  event: string | null;
}
export function parseThreadLocation(params: URLSearchParams): ThreadLocation {
  return { root: params.get('thread'), message: params.get('message'), event: params.get('event') };
}
/** Preserve unrelated parameters, event and hash; the accepted product contract uses message, not threadMessage. */
export function threadHref(url: URL, root: string | null, message: string | null = null) {
  const params = new URLSearchParams(url.search);
  params.delete('thread');
  params.delete('message');
  if (root !== null) params.set('thread', root);
  if (root !== null && message !== null) params.set('message', message);
  return `${url.pathname}${params.size ? `?${params}` : ''}${url.hash}`;
}
