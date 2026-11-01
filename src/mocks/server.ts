import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** MSW for Vitest (Node). */
export const server = setupServer(...handlers);
