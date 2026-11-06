/** How long we wait for the server to confirm that the refresh session is revoked. */
export const LOGOUT_TIMEOUT_MS = 5000;

/**
 * Orders "logout" before a following "login". Clearing the local session is instant, but the logout request may
 * still be on the wire, and its response carries a `Set-Cookie` that deletes the refresh cookie. If a login
 * finished in between, that late response would delete the NEW cookie. So a login first waits until the logout
 * request is settled (answered, failed, or aborted by `useLogout` after its timeout), at most `LOGOUT_TIMEOUT_MS`.
 */
let pending: Promise<void> | null = null;

/** Registers the logout request (any promise that settles when it is answered, failed or aborted). */
export function trackLogout(request: PromiseLike<unknown>): void {
  const settled: Promise<void> = Promise.resolve(request)
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      if (pending === settled) pending = null;
    });
  pending = settled;
}

export async function waitForPendingLogout(maxMs = LOGOUT_TIMEOUT_MS): Promise<void> {
  const waiting = pending;
  if (!waiting) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxMs);
  });
  await Promise.race([waiting, cap]);
  clearTimeout(timer);
}

export function resetLogoutCoordinator(): void {
  pending = null;
}
