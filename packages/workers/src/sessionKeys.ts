/**
 * `STWRD_SESSION_KEYS` — the keys that seal sessions before they go to a
 * Durable Object. Only the Workers adapter has it (`@stwrd-auth/node` keeps its
 * keyring in code, next to its PostgreSQL pool).
 *
 * Format: `id:key` entries separated by commas, each key 32 bytes in base64url
 * (no padding). The FIRST entry encrypts; every entry decrypts, so a key is
 * rotated by putting the new one first and dropping the old one once no
 * session is sealed with it. Empty, a repeated id, a malformed entry or a key
 * of another length: the configuration is not built (a Worker that cannot seal
 * must not start). Errors name the entry's position, never its key.
 */

import { ConfigError } from "@stwrd-auth/core/config";
import { Keyring } from "@stwrd-auth/core/keyring";

export const SESSION_KEYS_ENV = "STWRD_SESSION_KEYS";

const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;

export function parseSessionKeys(raw: unknown): Keyring {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new ConfigError(`${SESSION_KEYS_ENV} is required: id:key entries (32-byte base64url keys) separated by commas.`);
  }
  const entries: Array<[string, Uint8Array]> = [];
  raw.split(",").forEach((part, index) => {
    const position = `${SESSION_KEYS_ENV} entry ${index + 1}`;
    const colon = part.indexOf(":");
    const id = part.slice(0, colon).trim();
    const encoded = part.slice(colon + 1).trim();
    if (colon === -1 || !KEY_ID.test(id)) {
      throw new ConfigError(`${position} must be id:key, with an id of letters, digits, dot, underscore or hyphen (at most 64).`);
    }
    if (entries.some(([seen]) => seen === id)) {
      throw new ConfigError(`${position} repeats the key id "${id}".`);
    }
    const key = Buffer.from(encoded, "base64url");
    // `Buffer` skips what is not base64url and accepts padding: the round trip is the strict check.
    if (key.toString("base64url") !== encoded || key.length !== 32) {
      throw new ConfigError(`${position} must be a 32-byte key in base64url (43 characters, no padding).`);
    }
    entries.push([id, new Uint8Array(key)]);
  });
  // `fromEntries` defines own properties: an id such as `__proto__` stays a key.
  return new Keyring(Object.fromEntries(entries), entries[0][0]);
}
