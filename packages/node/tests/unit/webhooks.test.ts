/**
 * Standard Webhooks verification, checked against the shared test vector: the
 * exact bytes published in the webhooks contract, not a value this suite
 * invents.
 */

import { describe, expect, it } from "vitest";

import {
  DEDUP_WINDOW_S,
  DuplicateEventError,
  HEADER_ID,
  HEADER_SIGNATURE,
  HEADER_TIMESTAMP,
  InvalidSignatureError,
  SeenEventIds,
  SIGNATURE_PREFIX,
  TOLERANCE_S,
  safeEqual,
  signWebhook,
  verifyWebhook,
  verifyWebhookSignature,
} from "../../src/webhooks.js";

// The shared test vector of the webhooks contract. It is frozen and verified by
// every stwrd SDK and by the server itself: if one side's scheme drifts, this
// fails in CI and not in production. The body is a single line with no
// spaces; it is split below only for reading.
const VECTOR = {
  secret: "whsec-vector-compartido-stwrd",
  id: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
  timestamp: "1700000000",
  body:
    '{"id":"0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0","event":"User.EmailChanged",' +
    '"created_at":"2023-11-14T22:13:20Z","data":{"sub":"usr_vector",' +
    '"previous_email":"vieja@example.test","email":"nueva@example.test"}}',
  signature: "v1,cdw0E1NPAPrYhyWMKqOel7vqrOnxNjjSWbcWhqt2mWw=",
};
const VECTOR_SECRET = VECTOR.secret;
const VECTOR_ID = VECTOR.id;
const VECTOR_TIMESTAMP = VECTOR.timestamp;
const VECTOR_BODY = VECTOR.body;
const VECTOR_SIGNATURE = VECTOR.signature;

function headers(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [HEADER_ID]: VECTOR_ID,
    [HEADER_TIMESTAMP]: VECTOR_TIMESTAMP,
    [HEADER_SIGNATURE]: VECTOR_SIGNATURE,
    ...overrides,
  };
}

describe("constants match the webhooks contract", () => {
  it("names the wire exactly", () => {
    expect(HEADER_ID).toBe("webhook-id");
    expect(HEADER_TIMESTAMP).toBe("webhook-timestamp");
    expect(HEADER_SIGNATURE).toBe("webhook-signature");
    expect(SIGNATURE_PREFIX).toBe("v1,");
    expect(TOLERANCE_S).toBe(300);
    expect(DEDUP_WINDOW_S).toBe(30 * 3600);
  });
});

describe("the shared vector", () => {
  it("verifies", () => {
    // The vector's timestamp is fixed in the past (2023), so the replay
    // window is disabled here on purpose — this test is about the HMAC
    // scheme, not the clock.
    const eventId = verifyWebhookSignature(VECTOR_BODY, headers(), VECTOR_SECRET, {
      toleranceS: 10 ** 12,
    });
    expect(eventId).toBe(VECTOR_ID);
    expect(() => verifyWebhook(VECTOR_BODY, headers(), VECTOR_SECRET, { toleranceS: 10 ** 12 })).toThrow(InvalidSignatureError);
  });

  it("rejects a wrong secret", () => {
    expect(() =>
      verifyWebhook(VECTOR_BODY, headers(), "not-the-right-secret", { toleranceS: 10 ** 12 }),
    ).toThrow(InvalidSignatureError);
  });

  it("breaks when the body is re-serialized", () => {
    // The body is signed exactly as sent: re-serializing the JSON changes the
    // order and spacing, and verification starts failing on its own.
    // `JSON.stringify`'s compact form happens to match the vector's
    // own spacing byte-for-byte (unlike Python's default separators, which
    // add spaces), so this re-serializes WITH indentation — still the same
    // `JSON.parse(reserialized)` value, still different bytes.
    const reserialized = JSON.stringify(JSON.parse(VECTOR_BODY), null, 2);
    expect(reserialized).not.toBe(VECTOR_BODY); // sanity: the bytes actually differ
    expect(() =>
      verifyWebhook(reserialized, headers(), VECTOR_SECRET, { toleranceS: 10 ** 12 }),
    ).toThrow(InvalidSignatureError);
  });

  it("reads headers case-insensitively", () => {
    const eventId = verifyWebhookSignature(
      VECTOR_BODY,
      {
        "Webhook-Id": VECTOR_ID,
        "Webhook-Timestamp": VECTOR_TIMESTAMP,
        "Webhook-Signature": VECTOR_SIGNATURE,
      },
      VECTOR_SECRET,
      { toleranceS: 10 ** 12 },
    );
    expect(eventId).toBe(VECTOR_ID);
  });

  it.each(["+1700000000", "1_700_000_000", "１７００００００００", "not-a-number", ""])(
    "rejects a malformed timestamp %s",
    (timestamp) => {
      // The timestamp matches `^-?\d+$` and nothing else: no `+1700000000`,
      // no thousands separators, no Unicode digits.
      expect(() =>
        verifyWebhook(VECTOR_BODY, headers({ [HEADER_TIMESTAMP]: timestamp }), VECTOR_SECRET),
      ).toThrow(InvalidSignatureError);
    },
  );

  it("rejects a timestamp outside the replay window", () => {
    expect(() => verifyWebhook(VECTOR_BODY, headers(), VECTOR_SECRET, { toleranceS: 300 })).toThrow(
      InvalidSignatureError,
    );
  });

  it("accepts a current delivery within the default tolerance, signed with signWebhook", () => {
    // `signWebhook` is this SDK's own sending-side primitive
    // — this test pins that it round-trips through `verifyWebhook` for real, not a
    // hand-rolled HMAC call.
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const body = JSON.stringify({
      id,
      type: "user.created",
      api_version: "v1",
      created_at: "2026-01-01T00:00:00Z",
      data: { user_id: "usr_2" },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhook(VECTOR_SECRET, { eventId: id, timestamp, body });

    const event = verifyWebhook(
      body,
      { [HEADER_ID]: id, [HEADER_TIMESTAMP]: timestamp, [HEADER_SIGNATURE]: signature },
      VECTOR_SECRET,
    );
    expect(event.type).toBe("user.created");
  });

  it("accepts if any of multiple candidates matches", () => {
    // The signature header carries one or more space-separated signatures and
    // the delivery is accepted if any of them matches.
    const header = `v1,not-the-right-signature== ${VECTOR_SIGNATURE}`;
    const eventId = verifyWebhookSignature(VECTOR_BODY, headers({ [HEADER_SIGNATURE]: header }), VECTOR_SECRET, {
      toleranceS: 10 ** 12,
    });
    expect(eventId).toBe(VECTOR_ID);
  });

  it("fails cleanly on a candidate with non-ASCII bytes", () => {
    // A signature with non-ASCII bytes answers 400 invalid_signature like any
    // other bad signature, not a 500.
    expect(() =>
      verifyWebhook(VECTOR_BODY, headers({ [HEADER_SIGNATURE]: "v1,ééé==" }), VECTOR_SECRET, {
        toleranceS: 10 ** 12,
      }),
    ).toThrow(InvalidSignatureError);
  });
});

describe("dedup", () => {
  it("raises on a repeated id", () => {
    const seen = new Set<string>();
    const { body, signedHeaders } = signedEvent();
    verifyWebhook(body, signedHeaders, VECTOR_SECRET, { seen });
    expect(() =>
      verifyWebhook(body, signedHeaders, VECTOR_SECRET, { seen }),
    ).toThrow(DuplicateEventError);
  });

  it("SeenEventIds prunes after its window", () => {
    const seen = new SeenEventIds(0);
    seen.add(VECTOR_ID);
    // A zero-second window means the entry is immediately stale.
    expect(seen.has(VECTOR_ID)).toBe(false);
  });
});

describe("safeEqual", () => {
  it("is true only for equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

function signedEvent(overrides: Record<string, unknown> = {}) {
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const body = JSON.stringify({ id, type: "user.created", api_version: "v1", created_at: "2026-10-06T00:00:00Z", data: { user_id: "usr_2" }, ...overrides });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const wireId = String(JSON.parse(body).id);
  return { body, signedHeaders: { [HEADER_ID]: wireId, [HEADER_TIMESTAMP]: timestamp, [HEADER_SIGNATURE]: signWebhook(VECTOR_SECRET, { eventId: wireId, timestamp, body }) } };
}

describe("strict v1 envelope", () => {
  it("preserves producer data without adding legacy aliases", () => {
    const { body, signedHeaders } = signedEvent({ data: { extension: { value: 3 } } });
    expect(verifyWebhook(body, signedHeaders, VECTOR_SECRET)).toEqual(JSON.parse(body));
  });
  it.each([{ event: "User.Created" }, { api_version: "v2" }, { type: "" }, { data: [] }, { data: null }, { id: "other" }])("rejects signed invalid envelopes %j before recording dedup", (overrides) => {
    const { body, signedHeaders } = signedEvent(overrides);
    const seen = new Set<string>();
    expect(() => verifyWebhook(body, signedHeaders, VECTOR_SECRET, { seen })).toThrow(InvalidSignatureError);
    expect(seen.size).toBe(0);
  });
});

describe("v1 identity and UTC calendar", () => {
  it.each(["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"])("accepts canonical UUID %s without rewriting it", (id) => {
    const { body, signedHeaders } = signedEvent({ id, created_at: "2026-10-06T00:00:00.123456+00:00" });
    expect(verifyWebhook(body, signedHeaders, VECTOR_SECRET)).toEqual(JSON.parse(body));
  });
  it.each(["2026-02-30T00:00:00Z", "2025-02-29T00:00:00Z", "2026-13-01T00:00:00Z", "2026-10-06T24:00:00Z", "2026-10-06T00:00:00", "2026-10-06T00:00:00+01:00", "garbage", "", null, 7])("rejects a signed non-UTC or impossible date %j", (created_at) => {
    const { body, signedHeaders } = signedEvent({ created_at });
    expect(() => verifyWebhook(body, signedHeaders, VECTOR_SECRET)).toThrow(InvalidSignatureError);
  });
  it.each(["aaaaaaaabbbbccccddddeeeeeeeeeeee", "urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "evt-1", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n", null, 7])("rejects a signed noncanonical UUID %j", (id) => {
    const { body, signedHeaders } = signedEvent({ id });
    expect(verifyWebhookSignature(body, signedHeaders, VECTOR_SECRET)).toBe(String(id));
    expect(() => verifyWebhook(body, signedHeaders, VECTOR_SECRET)).toThrow(InvalidSignatureError);
  });
  it("rejects a header UUID case mismatch while raw verification remains valid", () => {
    const { body, signedHeaders } = signedEvent({ id: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE" });
    signedHeaders[HEADER_ID] = signedHeaders[HEADER_ID].toLowerCase();
    signedHeaders[HEADER_SIGNATURE] = signWebhook(VECTOR_SECRET, { eventId: signedHeaders[HEADER_ID], timestamp: signedHeaders[HEADER_TIMESTAMP], body });
    expect(verifyWebhookSignature(body, signedHeaders, VECTOR_SECRET)).toBe(signedHeaders[HEADER_ID]);
    expect(() => verifyWebhook(body, signedHeaders, VECTOR_SECRET)).toThrow(InvalidSignatureError);
  });
});

it("raw verification accepts arbitrary signed bytes and header identifiers without parsing", () => {
  const body = Buffer.from([0xff, 0x00, 0x2e]);
  const eventId = "evt-1", timestamp = String(Math.floor(Date.now() / 1000));
  const signedHeaders = { [HEADER_ID]: eventId, [HEADER_TIMESTAMP]: timestamp, [HEADER_SIGNATURE]: signWebhook(VECTOR_SECRET, { eventId, timestamp, body }) };
  expect(verifyWebhookSignature(body, signedHeaders, VECTOR_SECRET)).toBe(eventId);
  expect(() => verifyWebhook(body, signedHeaders, VECTOR_SECRET)).toThrow(InvalidSignatureError);
});
