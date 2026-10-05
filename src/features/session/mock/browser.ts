const cookieName = 'ir_fictional_client';
/** Public correlation handle, NOT a bearer credential. Browser mock auth is not security. */
export function fictionalClientId() {
  const value = document.cookie
    .split('; ')
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (value && /^[a-zA-Z0-9-]{1,100}$/.test(value)) return value;
  const client = crypto.randomUUID();
  document.cookie = `${cookieName}=${client}; Path=/; SameSite=Strict; Max-Age=86400`;
  return client;
}
export function forgetFictionalClient(expectedClient: string) {
  const current = document.cookie
    .split('; ')
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  // A stale tab must not clear a newer identity's correlation cookie.
  if (current === expectedClient)
    document.cookie = `${cookieName}=; Path=/; SameSite=Strict; Max-Age=0`;
}
