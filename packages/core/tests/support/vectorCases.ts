// The one table of cross-runtime vectors. Node computes the reference values
// (`global-setup.ts`) and workerd recomputes them (`vectors.test.ts`); no
// expected value is written by hand, so the table cannot drift from the code.
import { csrfToken, sign, unsign } from "../../src/crypto.js";
import { challengeS256, halfHash } from "../../src/oidc.js";
import {
  HEADER_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  signWebhook,
  verifyWebhookSignature,
} from "../../src/webhooks.js";

const SECRET = "s3cr3t-ключ-ñ";
const DATA = "sid:abc/+=ñ€😀";
const WEBHOOK_SECRET = "whsec_test";
const EVENT_ID = "11111111-2222-3333-4444-555555555555";
const TIMESTAMP = "1700000000";
const BODY = '{"a":1,"ñ":"€"}';
const AT = "access-token-xyz";

const outcome = (run: () => unknown): unknown => {
  try {
    return { value: run() };
  } catch (exc) {
    return { error: (exc as Error).name };
  }
};
const webhookHeaders = (signature: string) => ({
  [HEADER_ID]: EVENT_ID,
  [HEADER_TIMESTAMP]: TIMESTAMP,
  [HEADER_SIGNATURE]: signature,
});
const verifyAt = (signature: string, body = BODY) =>
  outcome(() => verifyWebhookSignature(body, webhookHeaders(signature), WEBHOOK_SECRET, { toleranceS: 1e12 }));

export interface VectorCase {
  readonly name: string;
  readonly run: () => unknown;
}

export const VECTOR_CASES: readonly VectorCase[] = [
  { name: "sign", run: () => sign(SECRET, DATA) },
  { name: "unsign:own signature", run: () => unsign(SECRET, DATA, sign(SECRET, DATA)) },
  { name: "unsign:longer signature", run: () => unsign(SECRET, DATA, sign(SECRET, DATA) + "x") },
  { name: "unsign:empty signature", run: () => unsign(SECRET, DATA, "") },
  { name: "unsign:other secret", run: () => unsign(SECRET + "x", DATA, sign(SECRET, DATA)) },
  { name: "csrf", run: () => csrfToken(SECRET, "sess-123") },
  { name: "pkce:S256", run: () => challengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") },
  { name: "halfHash:RS256", run: () => halfHash(AT, "RS256") },
  { name: "halfHash:EdDSA", run: () => halfHash(AT, "EdDSA") },
  { name: "halfHash:ES256", run: () => halfHash(AT, "ES256") },
  { name: "webhook:sign", run: () => signWebhook(WEBHOOK_SECRET, { eventId: EVENT_ID, timestamp: TIMESTAMP, body: BODY }) },
  {
    name: "webhook:verify own signature",
    run: () => verifyAt(signWebhook(WEBHOOK_SECRET, { eventId: EVENT_ID, timestamp: TIMESTAMP, body: BODY })),
  },
  {
    name: "webhook:verify tampered body",
    run: () => verifyAt(signWebhook(WEBHOOK_SECRET, { eventId: EVENT_ID, timestamp: TIMESTAMP, body: BODY }), BODY + " "),
  },
  { name: "webhook:verify short signature", run: () => verifyAt("v1,AAAA") },
];

export const computeVectors = (): Record<string, unknown> =>
  Object.fromEntries(VECTOR_CASES.map((vector) => [vector.name, vector.run()]));
