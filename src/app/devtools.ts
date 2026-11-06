import type { DevToolsEnhancerOptions } from '@reduxjs/toolkit';

/**
 * RTK Query keeps mutation arguments in the dispatched actions (`meta.arg.originalArgs`), so a login/register password
 * is visible in the Redux DevTools action history. It is never in the state. We keep RTK Query for Login/Register and
 * redact these keys from what DevTools shows.
 *
 * This only protects the DevTools view. The real actions still carry the values, so a middleware that ships actions
 * elsewhere (logger, error reporter) would leak them: sanitize there too, or take credentials out of RTK Query first.
 * Email and phone are personal data, not credentials, and stay visible in development.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set(['password', 'accessToken', 'refreshToken']);
const REDACTED = '[redacted]';
const TRUNCATED = '[truncated]';
const UNSUPPORTED = '[unsupported]';
const MAX_DEPTH = 10;

/** A copy with secret values replaced; the input is never mutated and untouched branches are shared. */
export function redactSecrets<T>(value: T): T {
  return redact(value, 0) as T;
}

function redact(value: unknown, depth: number): unknown {
  if (typeof value !== 'object' || value === null) return value;
  // Never hand back a branch that was not inspected: deeper than any real action (or cyclic) is cut off instead.
  if (depth > MAX_DEPTH) return TRUNCATED;
  // JSON.stringify calls an own `toJSON` (enumerable or not) on plain objects and arrays too. Only its descriptor is
  // looked at, so neither the method nor a getter ever runs.
  if (Object.getOwnPropertyDescriptor(value, 'toJSON')) return UNSUPPORTED;
  if (Array.isArray(value)) {
    // An Array subclass can bring its own `toJSON()` too; only real arrays are walked.
    if (Object.getPrototypeOf(value) !== Array.prototype) return UNSUPPORTED;
    const items = value.map((item) => redact(item, depth + 1));
    return items.some((item, i) => item !== value[i]) ? items : value;
  }
  // Only plain objects are walked. Anything else (class instance, Map, Date…) may serialize through an inherited
  // `toJSON()` or hidden state the walk never saw, so it is replaced, never passed through; Redux actions are plain.
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return UNSUPPORTED;
  const source = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(source)) {
    const next = SECRET_KEYS.has(key) ? REDACTED : redact(child, depth + 1);
    if (next !== child) (copy ??= { ...source })[key] = next;
  }
  return copy ?? value;
}

/** Production builds get no DevTools at all (the action history would otherwise be readable through the extension). */
export function devToolsOptions(isDevelopment: boolean): false | DevToolsEnhancerOptions {
  // A wrapper, not `redactSecrets` itself: Redux calls the sanitizer with `(action, id)`.
  return isDevelopment ? { actionSanitizer: (action) => redactSecrets(action) } : false;
}
