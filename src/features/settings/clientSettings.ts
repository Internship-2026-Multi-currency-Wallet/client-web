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

const isKnownKey = (key: string): key is ClientSettingKey => key in validators;

export const INVALID_SETTINGS_CODE = 'INVALID_SETTINGS';

export class InvalidSettingsError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid public settings: ${problems.join('; ')}`);
    this.problems = problems;
  }
}

/**
 * `publicSettings` list → typed object. Unknown extra keys are ignored (forward compatible);
 * duplicated, missing or malformed known keys throw `InvalidSettingsError`.
 */
export function parsePublicSettings(list: PublicSettingsQuery['publicSettings']): ClientSettings {
  const raw = new Map<string, unknown>();
  const duplicates = new Set<string>();
  for (const { key, value } of list) {
    if (raw.has(key) && isKnownKey(key)) duplicates.add(key);
    raw.set(key, value);
  }
  const problems: string[] = [];
  const result: Partial<Record<ClientSettingKey, unknown>> = {};
  for (const key of knownKeys) {
    if (duplicates.has(key)) {
      problems.push(`${key} is duplicated`);
      continue;
    }
    if (!raw.has(key)) {
      problems.push(`${key} is missing`);
      continue;
    }
    const value = validators[key](raw.get(key));
    if (value === undefined) problems.push(`${key} has an invalid value`);
    else result[key] = value;
  }
  if (problems.length > 0) throw new InvalidSettingsError(problems);
  return result as unknown as ClientSettings; // every known key was validated above
}

export function toInvalidSettingsRequestError(error: InvalidSettingsError): GraphQLRequestError {
  return { message: error.message, code: INVALID_SETTINGS_CODE };
}
