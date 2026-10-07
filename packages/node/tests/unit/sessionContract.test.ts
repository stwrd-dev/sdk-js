import { describe, expect, it } from "vitest";
import { contextFromClaims, hasRole, hasPermission, mergeClaims, sessionResponse, withoutCapabilities } from "@stwrd-auth/core/sessions";
import { createStwrd, ConfigError, requireOrg } from "../../src/index.js";
const org = { org_id: "opaque", org_display_name: "Team", org_roles: ["admin"], org_permissions: ["write"] };
describe("session contract", () => {
  it("normalizes profile and selects only the coherent authority family", () => {
    const individual = contextFromClaims({ sub: "u", roles: ["member"], permissions: ["read"] });
    expect(individual.user).toEqual({ id: "u", email: null, email_verified: false, display_name: null, avatar_url: null, roles: ["member"], permissions: ["read"] });
    expect(hasRole(individual, "member")).toBe(true);
    const organization = contextFromClaims({ sub: "u", ...org });
    expect(organization.user?.roles).toEqual([]);
    expect(organization.organization?.id).toBe("opaque");
    expect(hasRole(organization, "admin")).toBe(true);
    expect(hasPermission(organization, "write")).toBe(true);
  });
  it.each([
    { roles: ["admin"] }, { roles: ["admin"], permissions: [1] }, { org_roles: ["admin"] },
    { ...org, org_display_name: "" }, { ...org, roles: [], permissions: [] },
    { roles: ["admin"], permissions: [], org_id: null },
  ])("fails closed for malformed or contradictory families %j", claims => {
    const context = contextFromClaims({ sub: "u", ...claims });
    expect(context.organization).toBeNull();
    expect(context.user?.roles).toEqual([]);
    expect(context.user?.permissions).toEqual([]);
    expect(hasRole(context, "admin")).toBe(false);
  });
  it("userinfo cannot supply authority or sid and must match subject", () => {
    expect(mergeClaims({ sub: "u", roles: [], permissions: [], sid: "real" }, { sub: "u", ...org, sid: "fake", roles: ["admin"], consents: { terms: "accepted" } }, "u"))
      .toEqual({ sub: "u", roles: [], permissions: [], sid: "real", consents: { terms: "accepted" } });
    expect(mergeClaims({ sub: "u", consents: { injected: "accepted" } }, { sub: "u" }, "u")).toEqual({ sub: "u" });
    expect(() => mergeClaims({}, {}, undefined as unknown as string)).toThrow();
    expect(() => mergeClaims({ sub: "u" }, { sub: "other" }, "u")).toThrow();
    expect(() => mergeClaims({ sub: "other" }, { sub: "u" }, "u")).toThrow();
    expect(withoutCapabilities({ sub: "u", sid: "s", ...org, roles: ["a"], permissions: [] })).toEqual({ sub: "u", sid: "s" });
  });
  it("anonymous browser response has exact public fields and null CSRF", () => {
    expect(sessionResponse(null, "https://idp/me", "ignored")).toEqual({ authenticated: false, user: null, organization: null, consents: {}, csrf_token: null, account_url: "https://idp/me" });
  });
  it("requireOrg rejects a client configured without org scope", () => {
    const client = createStwrd({ issuer: "https://idp.test", clientId: "c", clientSecret: "s", baseUrl: "https://app.test", cookieSecret: "x".repeat(32) });
    expect(() => requireOrg(client)).toThrow(ConfigError);
  });
});
