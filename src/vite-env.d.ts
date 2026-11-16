/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: string;
  readonly VITE_CLIENT?: string;
  readonly VITE_WALLET_CORE_URL?: string;
  readonly VITE_RATES_SERVICE_URL?: string;
  readonly VITE_RATES_SERVICE_WS_URL?: string;
  readonly VITE_USE_MOCKS?: string;
  readonly VITE_DEV_USER?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
