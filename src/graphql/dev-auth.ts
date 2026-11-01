/**
 * Dev auth seam (frontend side). With `VITE_DEV_USER=1:wallet` every request carries
 * `Authorization: Dev 1:wallet`, which backends accept when they run with `DEV_AUTH=true`.
 * The real login (tokens) replaces this function only.
 */
export function authorizationHeader(devUser: string | null): string | undefined {
  return devUser ? `Dev ${devUser}` : undefined;
}

/** Permissions encoded in a dev user string, e.g. `100:bo:users,bo:users:modify`. */
export function devUserPermissions(devUser: string | null): string[] {
  if (!devUser) return [];
  const separator = devUser.indexOf(':');
  if (separator === -1) return [];
  return devUser
    .slice(separator + 1)
    .split(',')
    .map((permission) => permission.trim())
    .filter(Boolean);
}
