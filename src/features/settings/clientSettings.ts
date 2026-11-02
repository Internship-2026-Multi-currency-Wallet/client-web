import type { PublicSettingsQuery } from '../../gql/wallet-core/graphql';
import type { GraphQLRequestError } from '../../graphql/client';

/**
 * Public settings this client knows about, with their runtime-validated types.
 * The backend catalog is the source of truth for values and defaults: nothing is defaulted here.
 * Add a key = add one line to `validators` and one to `ClientSettings`.
 */
export interface ClientSettings {
  'auth.googleLogin': boolean;
  'auth.phoneRequiredAt': 'signup' | 'firstTransfer' | 'never';
  'products.enabled': string[];
}

export type ClientSettingKey = keyof ClientSettings;

const PHONE_REQUIRED_AT = ['signup', 'firstTransfer', 'never'] as const;

/** One validator per known key: returns the typed value, or `undefined` when the JSON is invalid. */
const validators: { [K in ClientSettingKey]: (value: unknown) => ClientSettings[K] | undefined } = {
  'auth.googleLogin': (value) => (typeof value === 'boolean' ? value : undefined),
  'auth.phoneRequiredAt': (value) => PHONE_REQUIRED_AT.find((allowed) => allowed === value),
  'products.enabled': (value) =>
    Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
      ? [...value]
      : undefined,
};

const knownKeys = Object.keys(validators) as ClientSettingKey[];

export const INVALID_SETTINGS_CODE = 'INVALID_SETTINGS';

export class InvalidSettingsError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid public settings: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

type PublicSettingsList = PublicSettingsQuery['publicSettings'];

type KeyCheck = { value: unknown } | { problem: string };

/** What is wrong with this known key in the list, if anything? Otherwise its validated value. */
function checkKey(list: PublicSettingsList, key: ClientSettingKey): KeyCheck {
  const entries = list.filter((setting) => setting.key === key);
  if (entries.length === 0) return { problem: `${key} is missing` };
  if (entries.length > 1) return { problem: `${key} is duplicated` };
  const value = validators[key](entries[0].value);
  return value === undefined ? { problem: `${key} has an invalid value` } : { value };
}

/**
 * `publicSettings` list → typed object. Unknown extra keys are ignored (forward compatible);
 * duplicated, missing or malformed known keys throw `InvalidSettingsError` (all problems at once).
 */
export function parsePublicSettings(list: PublicSettingsList): ClientSettings {
  const checks = knownKeys.map((key) => [key, checkKey(list, key)] as const);
  const problems = checks.flatMap(([, check]) => ('problem' in check ? [check.problem] : []));
  if (problems.length > 0) throw new InvalidSettingsError(problems);
  const values = checks.map(([key, check]) => [key, 'value' in check ? check.value : undefined]);
  return Object.fromEntries(values) as unknown as ClientSettings; // every known key was validated
}

export function toInvalidSettingsRequestError(error: InvalidSettingsError): GraphQLRequestError {
  return { message: error.message, code: INVALID_SETTINGS_CODE };
}
