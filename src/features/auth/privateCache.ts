import type { QueryCacheKey } from '@reduxjs/toolkit/query';
import { api } from '../../app/api';
import type { AppDispatch, RootState } from '../../app/store';

/**
 * Endpoints whose data is the same for everybody and may survive a change of identity (the client settings gate
 * of E1-2 must not flash its loading screen on login/logout). Everything else is treated as private.
 */
const PUBLIC_ENDPOINTS: ReadonlySet<string> = new Set(['walletCoreHealth', 'publicSettings']);

/**
 * Drops all cached private query data. Fail-closed: a new endpoint is private unless listed above.
 * Uses `internalActions.removeQueryResult` (not `resetApiState`) so public data and mounted gates stay put.
 */
export const clearPrivateCache = () => (dispatch: AppDispatch, getState: () => RootState) => {
  for (const [queryCacheKey, entry] of Object.entries(getState().api.queries)) {
    if (entry && !PUBLIC_ENDPOINTS.has(entry.endpointName ?? '')) {
      dispatch(
        api.internalActions.removeQueryResult({ queryCacheKey: queryCacheKey as QueryCacheKey }),
      );
    }
  }
};
