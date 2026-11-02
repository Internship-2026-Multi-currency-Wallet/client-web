import { useAppSelector } from '../../app/store';
import type { ClientSettingKey, ClientSettings } from './clientSettings';
import { settingsApi } from './settingsApi';

const selectPublicSettings = settingsApi.endpoints.publicSettings.select();

/**
 * Reads one public setting from the RTK Query cache (no request of its own).
 * Works under `SettingsGate`, which renders the app only after the settings have loaded.
 *
 *   const googleLogin = useClientSetting('auth.googleLogin'); // boolean
 */
export function useClientSetting<K extends ClientSettingKey>(key: K): ClientSettings[K] {
  const settings = useAppSelector(selectPublicSettings).data;
  if (!settings) throw new Error(`Setting "${key}" read before settings were loaded`);
  return settings[key];
}
