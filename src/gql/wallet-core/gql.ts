/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  mutation Register($input: RegisterInput!) {\n    register(input: $input) {\n      id\n      email\n      phone\n    }\n  }\n": typeof types.RegisterDocument,
    "\n  mutation Login($input: LoginInput!) {\n    login(input: $input) {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n": typeof types.LoginDocument,
    "\n  mutation Logout {\n    logout\n  }\n": typeof types.LogoutDocument,
    "\n  query GoogleAccount {\n    googleAccount {\n      email\n      linkedAt\n    }\n  }\n": typeof types.GoogleAccountDocument,
    "\n  mutation StartGoogleLink {\n    startGoogleLink {\n      state\n      nonce\n      expiresAt\n    }\n  }\n": typeof types.StartGoogleLinkDocument,
    "\n  mutation LinkGoogleAccount($input: GoogleAuthInput!) {\n    linkGoogleAccount(input: $input) {\n      email\n      linkedAt\n    }\n  }\n": typeof types.LinkGoogleAccountDocument,
    "\n  mutation UnlinkGoogleAccount {\n    unlinkGoogleAccount\n  }\n": typeof types.UnlinkGoogleAccountDocument,
    "\n  mutation StartGoogleLogin {\n    startGoogleLogin {\n      state\n      nonce\n      expiresAt\n    }\n  }\n": typeof types.StartGoogleLoginDocument,
    "\n  mutation LoginWithGoogle($input: GoogleAuthInput!) {\n    loginWithGoogle(input: $input) {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n": typeof types.LoginWithGoogleDocument,
    "\n  query PublicSettings {\n    publicSettings {\n      key\n      value\n    }\n  }\n": typeof types.PublicSettingsDocument,
    "\n  query WalletCoreHealth {\n    health {\n      service\n      version\n      client\n      db\n      redis\n    }\n  }\n": typeof types.WalletCoreHealthDocument,
    "\n  query Me {\n    me {\n      id\n      kind\n      permissions\n      strategy\n    }\n  }\n": typeof types.MeDocument,
    "\n  mutation RefreshSession {\n    refreshSession {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n": typeof types.RefreshSessionDocument,
};
const documents: Documents = {
    "\n  mutation Register($input: RegisterInput!) {\n    register(input: $input) {\n      id\n      email\n      phone\n    }\n  }\n": types.RegisterDocument,
    "\n  mutation Login($input: LoginInput!) {\n    login(input: $input) {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n": types.LoginDocument,
    "\n  mutation Logout {\n    logout\n  }\n": types.LogoutDocument,
    "\n  query GoogleAccount {\n    googleAccount {\n      email\n      linkedAt\n    }\n  }\n": types.GoogleAccountDocument,
    "\n  mutation StartGoogleLink {\n    startGoogleLink {\n      state\n      nonce\n      expiresAt\n    }\n  }\n": types.StartGoogleLinkDocument,
    "\n  mutation LinkGoogleAccount($input: GoogleAuthInput!) {\n    linkGoogleAccount(input: $input) {\n      email\n      linkedAt\n    }\n  }\n": types.LinkGoogleAccountDocument,
    "\n  mutation UnlinkGoogleAccount {\n    unlinkGoogleAccount\n  }\n": types.UnlinkGoogleAccountDocument,
    "\n  mutation StartGoogleLogin {\n    startGoogleLogin {\n      state\n      nonce\n      expiresAt\n    }\n  }\n": types.StartGoogleLoginDocument,
    "\n  mutation LoginWithGoogle($input: GoogleAuthInput!) {\n    loginWithGoogle(input: $input) {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n": types.LoginWithGoogleDocument,
    "\n  query PublicSettings {\n    publicSettings {\n      key\n      value\n    }\n  }\n": types.PublicSettingsDocument,
    "\n  query WalletCoreHealth {\n    health {\n      service\n      version\n      client\n      db\n      redis\n    }\n  }\n": types.WalletCoreHealthDocument,
    "\n  query Me {\n    me {\n      id\n      kind\n      permissions\n      strategy\n    }\n  }\n": types.MeDocument,
    "\n  mutation RefreshSession {\n    refreshSession {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n": types.RefreshSessionDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Register($input: RegisterInput!) {\n    register(input: $input) {\n      id\n      email\n      phone\n    }\n  }\n"): (typeof documents)["\n  mutation Register($input: RegisterInput!) {\n    register(input: $input) {\n      id\n      email\n      phone\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Login($input: LoginInput!) {\n    login(input: $input) {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation Login($input: LoginInput!) {\n    login(input: $input) {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation Logout {\n    logout\n  }\n"): (typeof documents)["\n  mutation Logout {\n    logout\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GoogleAccount {\n    googleAccount {\n      email\n      linkedAt\n    }\n  }\n"): (typeof documents)["\n  query GoogleAccount {\n    googleAccount {\n      email\n      linkedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartGoogleLink {\n    startGoogleLink {\n      state\n      nonce\n      expiresAt\n    }\n  }\n"): (typeof documents)["\n  mutation StartGoogleLink {\n    startGoogleLink {\n      state\n      nonce\n      expiresAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LinkGoogleAccount($input: GoogleAuthInput!) {\n    linkGoogleAccount(input: $input) {\n      email\n      linkedAt\n    }\n  }\n"): (typeof documents)["\n  mutation LinkGoogleAccount($input: GoogleAuthInput!) {\n    linkGoogleAccount(input: $input) {\n      email\n      linkedAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation UnlinkGoogleAccount {\n    unlinkGoogleAccount\n  }\n"): (typeof documents)["\n  mutation UnlinkGoogleAccount {\n    unlinkGoogleAccount\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StartGoogleLogin {\n    startGoogleLogin {\n      state\n      nonce\n      expiresAt\n    }\n  }\n"): (typeof documents)["\n  mutation StartGoogleLogin {\n    startGoogleLogin {\n      state\n      nonce\n      expiresAt\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation LoginWithGoogle($input: GoogleAuthInput!) {\n    loginWithGoogle(input: $input) {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation LoginWithGoogle($input: GoogleAuthInput!) {\n    loginWithGoogle(input: $input) {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query PublicSettings {\n    publicSettings {\n      key\n      value\n    }\n  }\n"): (typeof documents)["\n  query PublicSettings {\n    publicSettings {\n      key\n      value\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query WalletCoreHealth {\n    health {\n      service\n      version\n      client\n      db\n      redis\n    }\n  }\n"): (typeof documents)["\n  query WalletCoreHealth {\n    health {\n      service\n      version\n      client\n      db\n      redis\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Me {\n    me {\n      id\n      kind\n      permissions\n      strategy\n    }\n  }\n"): (typeof documents)["\n  query Me {\n    me {\n      id\n      kind\n      permissions\n      strategy\n    }\n  }\n"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation RefreshSession {\n    refreshSession {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n"): (typeof documents)["\n  mutation RefreshSession {\n    refreshSession {\n      accessToken\n      accessTokenExpiresAt\n      user {\n        id\n        email\n        phone\n      }\n    }\n  }\n"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;