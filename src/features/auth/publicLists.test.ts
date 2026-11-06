import { getOperationAST } from 'graphql';
import { api } from '../../app/api';
import { PUBLIC_OPERATIONS } from '../../graphql/client';
import '../settings/settingsApi';
import '../system/systemApi';
import { publicSettingsQuery } from '../settings/settings.wallet-core';
import { meQuery, walletCoreHealthQuery } from '../system/system.wallet-core';
import { PUBLIC_ENDPOINTS } from './privateCache';

/**
 * Two lists say what is "public" (the same for everybody): `PUBLIC_OPERATIONS` (GraphQL operation names, client.ts:
 * such a request survives a change of user) and `PUBLIC_ENDPOINTS` (RTK Query endpoints, privateCache.ts: such cached
 * data survives login/logout). They must describe the same things, or one half of the behaviour silently stops.
 */
describe('public operation and endpoint lists', () => {
  const lowerFirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

  it('name the same things (operation `PublicSettings` <-> endpoint `publicSettings`)', () => {
    expect(new Set([...PUBLIC_OPERATIONS].map(lowerFirst))).toEqual(new Set(PUBLIC_ENDPOINTS));
  });

  it('only list endpoints that exist, so a rename cannot leave a stale entry', () => {
    for (const endpoint of PUBLIC_ENDPOINTS) expect(api.endpoints).toHaveProperty(endpoint);
  });

  it('only list operations that exist as documents', () => {
    const documents = [walletCoreHealthQuery, publicSettingsQuery, meQuery];
    const names = documents.map((document) => getOperationAST(document)?.name?.value);
    for (const operation of PUBLIC_OPERATIONS) expect(names).toContain(operation);
  });

  it('do not include private data such as `Me`', () => {
    expect(PUBLIC_OPERATIONS.has('Me')).toBe(false);
    expect(PUBLIC_ENDPOINTS.has('me')).toBe(false);
  });
});
