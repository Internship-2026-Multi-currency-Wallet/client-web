import { config } from '../config-env';
import { worker } from './browser';

/** Is this request addressed to one of the backends the mocks are supposed to stand in for? */
function isBackendRequest(url: string): boolean {
  return [config.walletCoreUrl, config.ratesServiceUrl].some((backend) =>
    url.startsWith(new URL(backend, globalThis.location.href).toString()),
  );
}

/**
 * Starts MSW in the browser.
 *
 * A plain `onUnhandledFrame: 'bypass'` is dangerous here: when no handler matches, the request silently goes to
 * the real (not running) backend and the only symptom is `net::ERR_CONNECTION_REFUSED` while the "mocks" badge is
 * shown. So a backend request without a handler is reported in the console; everything else (Vite assets, fonts)
 * still passes through quietly.
 */
export async function startMocks(): Promise<void> {
  await worker.start({
    quiet: true,
    onUnhandledFrame: ({ frame, defaults }) => {
      const request = (frame.data as { request?: Request } | undefined)?.request;
      if (request && isBackendRequest(request.url)) defaults.warn();
    },
  });

  // Another cause of the same symptom: a page that the service worker does not control (e.g. after a forced
  // reload) bypasses MSW completely, whatever the handlers say.
  if (!navigator.serviceWorker.controller) {
    console.error(
      '[mocks] This page is not controlled by the mock service worker, so requests will reach the network. ' +
        'Reload the page normally (not Ctrl+Shift+R) and make sure "Bypass for network" is off in DevTools.',
    );
  }
}
