import { serverTimeActions, serverTimeReducer } from './serverTimeSlice';

describe('serverTimeSlice', () => {
  it('stores received values and errors', () => {
    let state = serverTimeReducer(undefined, { type: 'init' });
    expect(state.status).toBe('idle');

    state = serverTimeReducer(state, serverTimeActions.received('2026-01-01T00:00:00.000Z'));
    expect(state).toEqual({ status: 'live', value: '2026-01-01T00:00:00.000Z', error: null });

    state = serverTimeReducer(state, serverTimeActions.failed('Authentication required'));
    expect(state.status).toBe('error');
    expect(state.value).toBe('2026-01-01T00:00:00.000Z');
  });
});
