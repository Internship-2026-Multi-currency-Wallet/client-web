/**
 * jsdom has no Web Locks. This is a minimal model of `navigator.locks.request` (exclusive mode, `signal` option) with
 * the semantics the session code relies on:
 *
 * - One FIFO queue PER LOCK NAME: the same name is mutually exclusive, different names are independent (so nested
 *   `wallet.auth-cookie` -> `wallet.session` works like in a browser).
 * - The callback runs asynchronously after the grant, and the lock is released when the callback's result settles,
 *   whether it resolves, rejects or throws.
 * - `signal` only matters WHILE WAITING: an already aborted signal rejects at once and nothing is queued; aborting a
 *   queued request removes it and rejects with the signal's reason; aborting after the lock was reserved but before the
 *   callback started also rejects, never runs the callback and releases the lock; aborting once the callback runs
 *   changes nothing (it keeps the lock and the request resolves with its result).
 *
 * It is a model, not the browser: it proves our ordering logic, not that a real browser behaves the same.
 */
export interface FakeLockOptions {
  signal?: AbortSignal;
}

interface Waiter {
  grant: () => void;
}

interface LockState {
  held: boolean;
  queue: Waiter[];
}

export class FakeLockManager {
  private readonly locks = new Map<string, LockState>();

  private state(name: string): LockState {
    let state = this.locks.get(name);
    if (!state) {
      state = { held: false, queue: [] };
      this.locks.set(name, state);
    }
    return state;
  }

  /** Test helper: the number of requests waiting for `name` (not counting the holder). */
  pending(name: string): number {
    return this.locks.get(name)?.queue.length ?? 0;
  }

  /** Test helper: is any lock held or any request waiting? */
  isBusy(): boolean {
    return [...this.locks.values()].some((state) => state.held || state.queue.length > 0);
  }

  /** Test helper: is `name` currently held? */
  isHeld(name: string): boolean {
    return this.locks.get(name)?.held ?? false;
  }

  request<T>(
    name: string,
    optionsOrCallback: FakeLockOptions | (() => T | Promise<T>),
    maybeCallback?: () => T | Promise<T>,
  ): Promise<T> {
    const callback = (maybeCallback ?? optionsOrCallback) as () => T | Promise<T>;
    const signal = maybeCallback ? (optionsOrCallback as FakeLockOptions).signal : undefined;
    // Like the real API: an already aborted signal rejects at once and the request is never queued.
    if (signal?.aborted) return Promise.reject(signal.reason);

    const state = this.state(name);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        const index = state.queue.indexOf(waiter);
        if (index === -1) return; // already granted: aborting no longer matters
        state.queue.splice(index, 1);
        reject(signal!.reason);
      };
      const waiter: Waiter = {
        grant: () => {
          // Reserved, not started: the signal still counts until the callback is about to run (see `start`).
          state.held = true;
          // Released when the callback has settled, however it ended, and BEFORE the request settles (as in browsers).
          const release = () => {
            state.held = false;
            this.drain(state);
          };
          const start = () => {
            signal?.removeEventListener('abort', onAbort); // from now on the signal is irrelevant
            // Aborted after the reservation but before the callback: it must not run; the lock is released below.
            if (signal?.aborted) throw signal.reason;
            return callback();
          };
          void Promise.resolve()
            .then(start)
            .then(
              (value) => {
                release();
                resolve(value);
              },
              (error: unknown) => {
                release();
                reject(error);
              },
            );
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      state.queue.push(waiter);
      this.drain(state);
    });
  }

  private drain(state: LockState): void {
    if (state.held) return;
    state.queue.shift()?.grant();
  }
}
