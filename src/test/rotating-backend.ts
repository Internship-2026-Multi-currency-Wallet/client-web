/**
 * TEST-ONLY model of the server side of refresh-token rotation, for deterministic concurrency tests.
 *
 * Confirmed by the backend developer: every successful `refreshSession` issues a NEW refresh token, the previous one
 * is invalid immediately, there is no grace period. Here that is a synchronous check-and-replace on an in-memory
 * table, so it is atomic by itself (one JS turn), independently of any frontend lock.
 *
 * What it models: opaque tokens and their validity, the request/response timing of a "network" (two gates), and a
 * cookie jar that applies `Set-Cookie` when the response is DELIVERED.
 * What it does NOT model (and cannot prove): real HttpOnly cookie behavior, `Set-Cookie` of aborted requests, cookie
 * attributes, CORS, or what the real backend revokes on logout/login. It never touches `localStorage`,
 * `document.cookie` or `navigator.locks`; it lives and dies with the test.
 */
export interface Gate {
  /** Resolves when `open()` is called (immediately if it already was). */
  readonly promise: Promise<void>;
  open: () => void;
}

export function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

/** Optional pauses of one request: before the server handles it, and before the browser receives the answer. */
export interface Gates {
  arrival?: Promise<void>;
  delivery?: Promise<void>;
}

/** A successful refresh carries the new token (the `Set-Cookie`); a failed one carries no cookie change. */
export type ServerResponse = { ok: true; userId: string; token: string } | { ok: false };

/** The browser's cookie for the API (HttpOnly in reality: only requests read it). Shared by all "tabs" of a test. */
export class CookieJar {
  value: string | null = null;
}

export class RotatingBackend {
  private readonly live = new Map<string, string>(); // refresh token -> user id
  private counter = 0;
  /** What happened on the server, in order (consumption time, not delivery time). */
  readonly events: string[] = [];

  private mint(userId: string): string {
    this.counter += 1;
    const token = `R${this.counter}`;
    this.live.set(token, userId);
    return token;
  }

  /** Server action of a login: a new session with its first refresh token. */
  login(userId: string): string {
    const token = this.mint(userId);
    this.events.push(`login:${userId}:${token}`);
    return token;
  }

  /** Atomic: consumes `token` (if valid) and issues its successor in the same step. */
  consume(token: string | null): ServerResponse {
    const userId = token === null ? undefined : this.live.get(token);
    if (token === null || userId === undefined) {
      this.events.push(`refresh:${token ?? 'none'}:invalid`);
      return { ok: false };
    }
    this.live.delete(token);
    const next = this.mint(userId);
    this.events.push(`refresh:${token}:ok->${next}`);
    return { ok: true, userId, token: next };
  }

  /** Server action of a logout: revokes the session of the cookie's token. Always succeeds. */
  revoke(token: string | null): void {
    if (token !== null) this.live.delete(token);
    this.events.push(`logout:${token ?? 'none'}`);
  }

  /** The user a currently valid token belongs to (a pure read), `null` for an unknown, revoked or missing token. */
  ownerOf(token: string | null): string | null {
    return token === null ? null : (this.live.get(token) ?? null);
  }

  isValid(token: string | null): boolean {
    return token !== null && this.live.has(token);
  }

  /** Tokens that are valid right now. */
  validTokens(): string[] {
    return [...this.live.keys()];
  }
}

/** The request leaves with the cookie of this moment; the answer's `Set-Cookie` is applied on delivery. */
export async function refreshOverNetwork(
  backend: RotatingBackend,
  jar: CookieJar,
  gates: Gates = {},
): Promise<ServerResponse> {
  const sentWith = jar.value;
  await gates.arrival;
  const response = backend.consume(sentWith);
  await gates.delivery;
  if (response.ok) jar.value = response.token;
  return response;
}

export async function loginOverNetwork(
  backend: RotatingBackend,
  jar: CookieJar,
  userId: string,
  gates: Gates = {},
): Promise<string> {
  await gates.arrival;
  const token = backend.login(userId);
  await gates.delivery;
  jar.value = token;
  return token;
}

export async function logoutOverNetwork(
  backend: RotatingBackend,
  jar: CookieJar,
  gates: Gates = {},
): Promise<void> {
  const sentWith = jar.value;
  await gates.arrival;
  backend.revoke(sentWith);
  await gates.delivery;
  jar.value = null; // Set-Cookie that deletes the cookie
}
