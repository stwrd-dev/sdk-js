/**
 * Named 32-byte keys for encrypting session rows (JWE `dir` + `A256GCM`, via
 * jose). Shared by every store that keeps sessions outside the process: the
 * PostgreSQL store of `@stwrd-auth/node` and the Durable Object store of
 * `@stwrd-auth/workers`.
 */

import { CompactEncrypt, compactDecrypt, decodeProtectedHeader } from "jose";

/** Named 32-byte keys. `current` encrypts; every key decrypts, so a key is
 * rotated by adding the new one, switching `current`, and dropping the old one
 * once no row uses it. */
export class Keyring {
  constructor(readonly keys: Readonly<Record<string, Uint8Array>>, readonly current: string) {
    if (!Object.hasOwn(keys, current)) throw new Error("The current key id is not in the keyring.");
    if (Object.values(keys).some(key => key.length !== 32)) throw new Error("Every keyring key must be exactly 32 bytes.");
  }
  async encrypt(plaintext: string): Promise<string> {
    return new CompactEncrypt(new TextEncoder().encode(plaintext))
      .setProtectedHeader({ alg: "dir", enc: "A256GCM", kid: this.current })
      .encrypt(this.keys[this.current]);
  }
  async decrypt(token: string): Promise<string> {
    // The header only selects the key; it is authenticated as AAD on decrypt.
    const kid = decodeProtectedHeader(token).kid;
    if (typeof kid !== "string" || !Object.hasOwn(this.keys, kid)) throw new Error("Unknown key id.");
    const { plaintext } = await compactDecrypt(token, this.keys[kid], { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
    return new TextDecoder().decode(plaintext);
  }
}
