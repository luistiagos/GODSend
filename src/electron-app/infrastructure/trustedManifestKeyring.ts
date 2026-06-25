import type { TrustedManifestKeyring } from "./trustedComponentManifest";

/**
 * Public release keys trusted by the application.
 *
 * This must contain public keys only. A private signing key must never be
 * committed, bundled or placed in the application workspace. The empty
 * keyring intentionally keeps component installation fail-closed until the
 * release signing procedure and key custody are approved.
 */
export const PRODUCTION_TRUSTED_MANIFEST_KEYS: TrustedManifestKeyring = Object.freeze({});

