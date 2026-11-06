import { FakeLockManager } from './fake-locks';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

describe('FakeLockManager: one queue per lock name', () => {
  it('serializes requests for the same name, in order', async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const hold = deferred();
    const a = locks.request('x', async () => {
      log.push('a:start');
      await hold.promise;
      log.push('a:end');
    });
    const b = locks.request('x', () => void log.push('b'));
    const c = locks.request('x', () => void log.push('c'));
    await tick();
    expect(log).toEqual(['a:start']); // b and c wait
    expect(locks.pending('x')).toBe(2);
    hold.release();
    await Promise.all([a, b, c]);
    expect(log).toEqual(['a:start', 'a:end', 'b', 'c']);
  });

  it('lets different names run at the same time', async () => {
    const locks = new FakeLockManager();
    const hold = deferred();
    const first = locks.request('one', () => hold.promise);
    await tick();
    expect(locks.isHeld('one')).toBe(true);

    // 'two' is not blocked by the holder of 'one'.
    await expect(locks.request('two', () => 'done')).resolves.toBe('done');
    expect(locks.isHeld('one')).toBe(true);
    hold.release();
    await first;
    expect(locks.isHeld('one')).toBe(false);
  });

  it('nested auth-cookie -> session does not deadlock, also with a plain session holder in between', async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const sessionHold = deferred();

    // Someone holds only the session lock (like a tab in a short storage write).
    const holder = locks.request('wallet.session', () => sessionHold.promise);
    // Two nested transactions: auth-cookie outside, session inside (the planned order).
    const nested = (label: string) =>
      locks.request('wallet.auth-cookie', async () => {
        log.push(`${label}:cookie`);
        await locks.request('wallet.session', () => void log.push(`${label}:session`));
      });
    const first = nested('A');
    const second = nested('B');
    await tick();
    expect(log).toEqual(['A:cookie']); // A waits inside for the session lock; B waits for the cookie lock

    sessionHold.release();
    await Promise.all([holder, first, second]);
    expect(log).toEqual(['A:cookie', 'A:session', 'B:cookie', 'B:session']);
    expect(locks.isHeld('wallet.auth-cookie')).toBe(false);
    expect(locks.isHeld('wallet.session')).toBe(false);
  });
});

describe('FakeLockManager: abort', () => {
  it('rejects at once for an already aborted signal and never runs the callback', async () => {
    const locks = new FakeLockManager();
    const callback = vi.fn();
    const reason = new DOMException('gone', 'AbortError');
    await expect(locks.request('x', { signal: AbortSignal.abort(reason) }, callback)).rejects.toBe(
      reason,
    );
    expect(callback).not.toHaveBeenCalled();
    expect(locks.pending('x')).toBe(0);
  });

  it('aborting a queued request removes it and does not disturb the holder or the others', async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const hold = deferred();
    const holder = locks.request('x', async () => {
      await hold.promise;
      log.push('holder');
    });
    const controller = new AbortController();
    const aborted = locks.request(
      'x',
      { signal: controller.signal },
      () => void log.push('aborted'),
    );
    const next = locks.request('x', () => void log.push('next'));
    await tick();
    expect(locks.pending('x')).toBe(2);

    controller.abort(new DOMException('timeout', 'TimeoutError'));
    await expect(aborted).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(locks.pending('x')).toBe(1);
    expect(locks.isHeld('x')).toBe(true); // the holder is untouched

    hold.release();
    await Promise.all([holder, next]);
    expect(log).toEqual(['holder', 'next']); // the aborted callback never ran
  });

  it('aborting AFTER the lock was granted is ignored: the callback keeps the lock and the request resolves', async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const controller = new AbortController();
    const hold = deferred();
    const granted = locks.request('x', { signal: controller.signal }, async () => {
      await hold.promise;
      log.push('granted:end');
      return 'result';
    });
    const waiting = locks.request('x', () => void log.push('waiting'));
    await tick();

    controller.abort(); // too late: it was not waiting any more
    await tick();
    expect(locks.isHeld('x')).toBe(true);
    expect(log).toEqual([]); // the waiter has NOT been let in early

    hold.release();
    await expect(granted).resolves.toBe('result');
    await waiting;
    expect(log).toEqual(['granted:end', 'waiting']);
  });
});

describe('FakeLockManager: abort between the reservation and the callback', () => {
  it('rejects with the reason, never runs the callback, releases the lock and lets the next waiter in', async () => {
    const locks = new FakeLockManager();
    const callback = vi.fn();
    const controller = new AbortController();
    const reason = new DOMException('too late to start', 'AbortError');

    // A free lock is reserved at once, but the callback only starts asynchronously: abort in that window.
    const aborted = locks.request('wallet.auth-cookie', { signal: controller.signal }, callback);
    const next = locks.request('wallet.auth-cookie', () => 'next');
    expect(locks.isHeld('wallet.auth-cookie')).toBe(true);
    controller.abort(reason);

    await expect(aborted).rejects.toBe(reason);
    expect(callback).not.toHaveBeenCalled();
    await expect(next).resolves.toBe('next'); // the reserved lock was released
    expect(locks.isHeld('wallet.auth-cookie')).toBe(false);
  });

  it('a waiter promoted by a release and aborted exactly before its callback is rejected, and the next waiter runs', async () => {
    const locks = new FakeLockManager();
    const reason = new DOMException('aborted at the promotion', 'AbortError');
    // A signal that turns "aborted" at a moment WE choose: when the holder finishes, i.e. after the waiter was queued
    // (so the queued-abort path is not used) and before the promoted waiter's callback can start.
    let aborted = false;
    const signal = {
      get aborted() {
        return aborted;
      },
      reason,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as AbortSignal;

    const hold = deferred();
    const holder = locks.request('x', async () => {
      await hold.promise;
      aborted = true; // the abort lands as the lock is about to be handed to the waiter
    });
    const callback = vi.fn();
    const waiter = locks.request('x', { signal }, callback);
    const swallowed = waiter.catch(() => undefined);
    const last = locks.request('x', () => 'last');
    expect(locks.pending('x')).toBe(2);

    hold.release();
    await holder;
    await expect(waiter).rejects.toBe(reason);
    await swallowed;
    expect(callback).not.toHaveBeenCalled();
    await expect(last).resolves.toBe('last');
    expect(locks.isHeld('x')).toBe(false);
  });

  it('abort once the callback HAS started does not release the lock', async () => {
    const locks = new FakeLockManager();
    const started = deferred();
    const hold = deferred();
    const log: string[] = [];
    const controller = new AbortController();
    const running = locks.request('x', { signal: controller.signal }, async () => {
      started.release();
      await hold.promise;
      log.push('running:end');
    });
    const next = locks.request('x', () => void log.push('next'));
    await started.promise;

    controller.abort();
    await tick();
    expect(locks.isHeld('x')).toBe(true);
    expect(log).toEqual([]);
    hold.release();
    await Promise.all([running, next]);
    expect(log).toEqual(['running:end', 'next']);
  });

  it('removes its abort listener once the request has started (no listener leak)', async () => {
    const locks = new FakeLockManager();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await locks.request('x', { signal: controller.signal }, () => 'done');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    remove.mockRestore();
  });
});

describe('FakeLockManager: release', () => {
  it('a rejected callback does not leave the lock held', async () => {
    const locks = new FakeLockManager();
    const failing = locks.request('x', async () => {
      throw new Error('boom');
    });
    const after = locks.request('x', () => 'after');
    await expect(failing).rejects.toThrow('boom');
    await expect(after).resolves.toBe('after');
    expect(locks.isHeld('x')).toBe(false);
  });

  it('a callback that throws synchronously does not leave the lock held', async () => {
    const locks = new FakeLockManager();
    const failing = locks.request('x', () => {
      throw new Error('sync boom');
    });
    const after = locks.request('x', () => 'after');
    await expect(failing).rejects.toThrow('sync boom');
    await expect(after).resolves.toBe('after');
  });

  it('releasing skips a waiter that was aborted meanwhile and wakes the next eligible one', async () => {
    const locks = new FakeLockManager();
    const log: string[] = [];
    const hold = deferred();
    const holder = locks.request('x', () => hold.promise);
    const controller = new AbortController();
    const gone = locks.request('x', { signal: controller.signal }, () => void log.push('gone'));
    const eligible = locks.request('x', () => void log.push('eligible'));
    const swallowed = gone.catch(() => undefined);
    controller.abort();
    hold.release();
    await Promise.all([holder, eligible, swallowed]);
    expect(log).toEqual(['eligible']);
  });
});

describe('navigator.locks in the test setup', () => {
  it('is the named-lock model: different names are independent', async () => {
    const hold = deferred();
    const first = navigator.locks.request('test.named-a', () => hold.promise);
    await tick();
    await expect(navigator.locks.request('test.named-b', () => 'free')).resolves.toBe('free');
    hold.release();
    await first;
  });
});
