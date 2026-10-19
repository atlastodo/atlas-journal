/**
 * Signing in to an Atlas account from Atlas Journal, and opening the journal's own key.
 *
 * The account is the suite's one account (the same email and password as Atlas Todo). Its keys
 * form a tree (`docs/architecture.md`, Account root key, in the core repository): the password
 * opens the account root key, and the root key opens each app's key. Journal uses only the
 * journal app key and identity (`account_app_keys`, app `journal`); it never keeps the todo key.
 * Every step here is client-core's: {@link openAccountKeys} for the root, {@link ensureRootKey} to
 * migrate an account from before root keys, {@link enableApp} to create (once, race-safe) and
 * open the journal key and enable the app for the account. No new crypto lives in this package.
 */

import {
  ApiClient,
  RootKeyRequiredError,
  assertServerCompatible,
  buildSignupRoot,
  bytesToHex,
  deriveAuthAndMekAsync,
  deriveRecoveryKeys,
  enableApp,
  ensureRootKey,
  generateDek,
  generateRecoveryPhrase,
  generateSalt,
  generateSigningKeypair,
  generateUserKeypair,
  getPublicKey,
  hexToBytes,
  kdfForNewCredential,
  kdfFromWire,
  Keyring,
  LEGACY_KDF,
  openAccountKeys,
  openAppKey,
  sessionFromAuth,
  unwrapRootKey,
  wrapKey,
  wrapSigningKey,
  type ApiClientOptions,
  type AppKeys,
  type AuthResponse,
  type PasswordKdf,
  type RootKeyState,
  type ServerRequirements,
  type Session,
} from "@atlastodo/client-core";
import { JOURNAL_APP } from "./entries";

/**
 * What Atlas Journal needs from a server, checked against `GET /discovery` before signing in:
 * root keys and per-account apps (the journal key lives under the root), app-scoped sync (the
 * journal syncs only its own ops) and the journal app offered (`ATLAS_APPS=todo,journal`).
 */
export const JOURNAL_SERVER_REQUIREMENTS: ServerRequirements = {
  minProtocol: 1,
  capabilities: ["root_key", "account_apps", "app_scoped_sync"],
  apps: [JOURNAL_APP],
};

/** Throws client-core's `ServerIncompatibleError` when the server cannot serve the journal. */
export async function ensureJournalServer(api: ApiClient): Promise<void> {
  assertServerCompatible(await api.getDiscovery(), JOURNAL_SERVER_REQUIREMENTS);
}

/** An `ApiClient` whose sync requests are scoped to the journal (`x-atlas-sync-apps: journal`). */
export function createJournalApiClient(opts: Omit<ApiClientOptions, "apps">): ApiClient {
  return new ApiClient({ ...opts, apps: [JOURNAL_APP] });
}

/** The journal app key and identity, unwrapped. Kept in memory; persisted only sealed. */
export interface JournalKeys {
  appKey: Uint8Array;
  privateKey: Uint8Array;
  /** The identity's public key (hex). */
  publicKey: string;
}

/**
 * The persisted session: client-core's {@link Session} (tokens, user, the wrapped root key and
 * app key rows) with the journal's keys in place of the todo DEK, which this app never stores
 * (`dek`, `privateKey` and `signingKey` stay unset).
 */
export interface JournalSession extends Session {
  /** The journal app key (hex); absent while the session is locked. */
  journalKey?: string;
  /** The journal identity's private key (hex). */
  journalPrivateKey?: string;
}

/** The keyring the journal syncs with: the journal app key in the DEK's role (envelope kid "dek"). */
export function journalKeyring(keys: JournalKeys): Keyring {
  return new Keyring({ dek: keys.appKey, privateKey: keys.privateKey, publicKey: keys.publicKey });
}

/** Journal keys from their stored hex form; null when they do not parse. */
export function keysFromHex(appKeyHex: string, privateKeyHex: string): JournalKeys | null {
  try {
    const appKey = hexToBytes(appKeyHex);
    const privateKey = hexToBytes(privateKeyHex);
    if (appKey.length !== 32 || privateKey.length !== 32) return null;
    return { appKey, privateKey, publicKey: getPublicKey(privateKey) };
  } catch {
    return null;
  }
}

/** The journal keys a session holds, or null when it is locked. */
export function sessionKeys(session: JournalSession | null): JournalKeys | null {
  if (!session?.journalKey || !session.journalPrivateKey) return null;
  return keysFromHex(session.journalKey, session.journalPrivateKey);
}

/** `session` holding `keys` (or locked, without). */
export function withKeys(session: JournalSession, keys: JournalKeys | null): JournalSession {
  const next: JournalSession = { ...session };
  delete next.dek;
  delete next.privateKey;
  delete next.signingKey;
  if (keys) {
    next.journalKey = bytesToHex(keys.appKey);
    next.journalPrivateKey = bytesToHex(keys.privateKey);
  } else {
    delete next.journalKey;
    delete next.journalPrivateKey;
  }
  return next;
}

/** A session without its journal keys (what the app shows the unlock screen for). */
export function lockedSession(session: JournalSession): JournalSession {
  return withKeys(session, null);
}

/** The account was created before encryption and cannot sign in. Shaped like the server's 403. */
export class LegacyAccountError extends Error {
  readonly code = "legacy_account";
  constructor() {
    super("this account was created before end-to-end encryption and cannot sign in");
    this.name = "LegacyAccountError";
  }
}

/** The wrong password for an unlock (the slot does not open). */
export class WrongPasswordError extends Error {
  constructor() {
    super("the password does not open this account's keys");
    this.name = "WrongPasswordError";
  }
}

interface Credential {
  authHash: string;
  mek: Uint8Array;
  salt: string;
  kdf: PasswordKdf;
}

/** The auth hash a password sign-in sends and the MEK that opens the account's keys. */
export async function deriveLoginCredential(
  api: Pick<ApiClient, "getSalt">,
  email: string,
  password: string,
): Promise<Credential> {
  const res = await api.getSalt(email);
  if (!res.is_e2ee) throw new LegacyAccountError();
  if (!res.salt) throw new Error("the server sent no salt for this account");
  // Throws for a KDF this client does not run: no credential it could derive would sign in.
  const kdf = kdfFromWire(res.kdf_version, res.kdf_params) ?? LEGACY_KDF;
  return { ...(await deriveAuthAndMekAsync(password, res.salt, kdf)), salt: res.salt, kdf };
}

function rootStateOf(session: Session): RootKeyState {
  return {
    hasRootKey: session.hasRootKey,
    encryptedRootKey: session.encryptedRootKey,
    appKeys: session.appKeys,
    hasRecoveryRootKey: session.hasRecoveryRootKey,
    recoveryPublicKey: session.recoveryPublicKey,
  };
}

function withRootState(session: JournalSession, state: RootKeyState): JournalSession {
  const next: JournalSession = { ...session, ...state };
  if (state.hasRootKey === false) delete next.encryptedRootKey;
  return next;
}

type KeyApi = Pick<
  ApiClient,
  "migrateRootKey" | "getRootKey" | "putRecoveryRootKey" | "putAppKey" | "enableAccountApp"
>;

/**
 * Open (creating it on first use) the journal key under an unlocked root, and enable the journal
 * for the account. Online: `enableApp` stores a new key once and enables the app idempotently.
 */
async function journalKeysUnder(
  api: KeyApi,
  session: JournalSession,
  rootKey: Uint8Array,
): Promise<{ keys: JournalKeys; session: JournalSession }> {
  const { keys, state } = await enableApp(api, {
    userId: session.user.id,
    rootKey,
    app: JOURNAL_APP,
    state: rootStateOf(session),
  });
  return { keys: fromAppKeys(keys), session: withRootState(session, state) };
}

function fromAppKeys(keys: AppKeys): JournalKeys {
  return { appKey: keys.appKey, privateKey: keys.privateKey, publicKey: keys.publicKey };
}

/**
 * The journal keys from what a password sign-in returned: root → (migrate when the account has
 * no root yet) → journal key. The todo keys this opens on the way are dropped.
 */
async function openFromAuth(
  api: KeyApi,
  auth: AuthResponse,
  credential: Credential,
): Promise<{ keys: JournalKeys; session: JournalSession }> {
  const account = openAccountKeys({
    userId: auth.user.id,
    mek: credential.mek,
    encryptedRootKey: auth.encrypted_root_key,
    appKeys: auth.app_keys,
    encryptedDek: auth.encrypted_dek,
    encryptedPrivateKey: auth.encrypted_private_key,
  });
  let session: JournalSession = { ...sessionFromAuth(auth), kdf: credential.kdf };
  let rootKey = account.rootKey;
  try {
    const migrated = await ensureRootKey(api, {
      userId: auth.user.id,
      authHash: credential.authHash,
      mek: credential.mek,
      dek: account.dek,
      privateKey: account.privateKey,
      rootKey,
      state: rootStateOf(session),
    });
    if (migrated) {
      rootKey = migrated.rootKey;
      session = withRootState(session, migrated.state);
    }
  } finally {
    account.dek.fill(0);
    account.privateKey.fill(0);
  }
  if (!rootKey) throw new RootKeyRequiredError();
  try {
    return await journalKeysUnder(api, session, rootKey);
  } finally {
    rootKey.fill(0);
  }
}

export interface SignInOptions {
  /** Shown in the account's Devices & sessions list. */
  deviceName?: string;
  /** Survives a reinstall (Android); the server replaces this install's older sessions. */
  installKey?: string;
}

export interface SignedIn {
  session: JournalSession;
  keys: JournalKeys;
}

/** Sign in with the account password and open the journal (enabling it on first use). */
export async function signIn(
  api: ApiClient,
  email: string,
  password: string,
  opts: SignInOptions = {},
): Promise<SignedIn> {
  await ensureJournalServer(api);
  const normalized = email.trim().toLowerCase();
  const credential = await deriveLoginCredential(api, normalized, password);
  const auth = await api.login(normalized, credential.authHash, opts.deviceName, opts.installKey);
  if (!auth.encrypted_dek || !auth.encrypted_private_key) throw new LegacyAccountError();
  // The key routes below are authenticated: the client must carry the new session's token.
  api.setTokens(auth.access_token, auth.refresh_token);
  try {
    const { keys, session } = await openFromAuth(api, auth, credential);
    return { keys, session: withKeys(session, keys) };
  } catch (err) {
    // No journal without its key: end the session the server just opened rather than leave it.
    await api.logout(auth.refresh_token).catch(() => {});
    api.setTokens(undefined, undefined);
    throw err;
  } finally {
    credential.mek.fill(0);
  }
}

/**
 * Create an account, exactly as Atlas Todo does (the todo key is the account's DEK and is always
 * enabled), then enable the journal under the new root. Resolves the recovery phrase, which the
 * app must show once: it is the only way back into the account without the password.
 */
export async function signUp(
  api: ApiClient,
  input: { email: string; password: string; displayName?: string; invite?: string },
  opts: SignInOptions = {},
): Promise<SignedIn & { recoveryPhrase: string }> {
  await ensureJournalServer(api);
  const email = input.email.trim().toLowerCase();
  const kdf = kdfForNewCredential(await api.getSalt(email));
  const salt = generateSalt();
  const { authHash, mek } = await deriveAuthAndMekAsync(input.password, salt, kdf);
  const dek = generateDek();
  const keypair = generateUserKeypair();
  const signing = generateSigningKeypair();
  const phrase = generateRecoveryPhrase();
  const recovery = deriveRecoveryKeys(phrase, salt);
  const root = buildSignupRoot({
    mek,
    recoveryWrapKey: recovery.wrapKey,
    dek,
    privateKey: keypair.secretKey,
  });
  try {
    const auth = await api.signup({
      email,
      password: authHash,
      displayName: input.displayName ?? "",
      invite: input.invite,
      deviceName: opts.deviceName,
      installKey: opts.installKey,
      salt,
      publicKey: keypair.publicKey,
      recoveryPublicKey: recovery.auth.publicKey,
      encryptedDek: wrapKey(dek, mek),
      encryptedPrivateKey: wrapKey(keypair.secretKey, mek),
      recoveryEncryptedDek: wrapKey(dek, recovery.wrapKey),
      recoveryEncryptedPrivateKey: wrapKey(keypair.secretKey, recovery.wrapKey),
      kdf,
      signingPublicKey: signing.publicKey,
      encryptedSigningKey: wrapSigningKey(signing.secretKey, dek),
      root,
    });
    api.setTokens(auth.access_token, auth.refresh_token);
    const session: JournalSession = { ...sessionFromAuth(auth), kdf };
    // `buildSignupRoot` keeps the root to itself; its password slot opens it again here.
    const rootKey = unwrapRootKey(root.encryptedRootKey, mek, root.userId, "password");
    try {
      const opened = await journalKeysUnder(api, session, rootKey);
      return {
        keys: opened.keys,
        session: withKeys(opened.session, opened.keys),
        recoveryPhrase: phrase,
      };
    } finally {
      rootKey.fill(0);
    }
  } finally {
    mek.fill(0);
    dek.fill(0);
    keypair.secretKey.fill(0);
    signing.secretKey.fill(0);
  }
}

/**
 * Unlock a restored session with the password: the MEK opens the root's password slot, the root
 * the journal key. Works offline once the session has the journal's row; without it (the journal
 * was enabled elsewhere since) it asks the server. Rejects with {@link WrongPasswordError} for a
 * password that does not open the slot.
 */
export async function unlock(
  api: ApiClient,
  session: JournalSession,
  password: string,
): Promise<SignedIn> {
  if (!session.salt || !session.encryptedRootKey) {
    throw new Error("this session cannot be unlocked here: sign in again");
  }
  const kdf = session.kdf ?? LEGACY_KDF;
  const { mek } = await deriveAuthAndMekAsync(password, session.salt, kdf);
  let rootKey: Uint8Array;
  try {
    rootKey = unwrapRootKey(session.encryptedRootKey, mek, session.user.id, "password");
  } catch {
    throw new WrongPasswordError();
  } finally {
    mek.fill(0);
  }
  try {
    if (session.appKeys?.some((k) => k.app === JOURNAL_APP)) {
      const keys = fromAppKeys(openAppKey(rootKey, session.user.id, JOURNAL_APP, session.appKeys));
      return { keys, session: withKeys(session, keys) };
    }
    const opened = await journalKeysUnder(api, session, rootKey);
    return { keys: opened.keys, session: withKeys(opened.session, opened.keys) };
  } finally {
    rootKey.fill(0);
  }
}
