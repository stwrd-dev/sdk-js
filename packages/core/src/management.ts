// Generated from the final mounted public OpenAPI schema. Do not edit.
import { ManagementTransport, type ManagementOptions, type WriteOptions } from "./managementTransport.js";
export { ManagementError, type ApiResult, type WriteOptions } from "./managementTransport.js";
export namespace Schemas {
  export type AccountDomainPatch = { "application_grants"?: Array<Schemas.DomainGrant> | null; "auto_join_enabled"?: boolean | null };
  export type AccountPolicyPatch = { "invitations_enabled"?: boolean; "remember_device_days"?: number };
  export type AccountPolicyResource = { "invitations_enabled": boolean; "remember_device_days": number };
  export type ActList = { "items": Array<Schemas.ActResource>; "page": Schemas.Page };
  export type ActResource = { "account_deleted_at": string | null; "application_client_id": string | null; "application_id": string | null; "channel": string; "decided_at": string; "decision": "accepted" | "declined"; "document_url": string; "id": string; "key": string; "label": string; "language": string; "organization_id": string | null; "revoked_at": string | null; "revoked_channel": string | null; "scope": "application" | "organization"; "subject_digest": string | null; "subject_id": string | null; "version": number };
  export type AdministrativePolicy = { "label": string | null; "min_acr": "1" | "mfa" | "mfa-strong" | "phr"; "role"?: "org:admin" };
  export type AdministrativePolicyPatch = { "label"?: string | null; "min_acr"?: "1" | "mfa" | "mfa-strong" | "phr" };
  export type AgentInstructionsResource = { "active_entry_methods": Array<string>; "client_id": string; "framework": string; "frameworks": Array<Schemas.FrameworkResource>; "instructions": string; "issuer": string; "redirect_uris": Array<string>; "sdk_package": string };
  export type AppleConfig = { "key_id": string; "team_id": string };
  export type Application = { "active": boolean; "client_id": string; "client_type": "m2m" | "spa" | "bff" | "native"; "console_family": boolean; "created_at": string; "display_name": string; "id": string; "identity_mode": "individual" | "organizations"; "invitable": boolean; "invitations_enabled": boolean; "updated_at": string };
  export type ApplicationCreate = { "client_id"?: string | null; "client_type"?: "m2m" | "spa" | "bff" | "native"; "display_name": string; "identity_mode"?: "individual" | "organizations"; "public"?: boolean; "redirect_uris"?: Array<string> };
  export type ApplicationList = { "items": Array<Schemas.Application>; "page": Schemas.Page };
  export type ApplicationPatch = { "active"?: boolean; "display_name"?: string; "identity_mode"?: "individual" | "organizations" };
  export type AssetResource = { "digest": string; "url": string };
  export type AssignedAccess = { "access": "individual" | "all" | "explicit" | "none"; "application_id": string; "organization_id": string | null; "role_ids": Array<string>; "user_id": string };
  export type AuditEventList = { "items": Array<Schemas.AuditEventResource>; "page": Schemas.Page };
  export type AuditEventResource = { "actor_id": string | null; "actor_kind": string; "actor_tenant": string; "capability": string; "channel": string; "client_id": string | null; "id": string; "method": string; "occurred_at": string; "organization_id": string | null; "path_template": string | null; "resource": string | null; "status_code": number | null };
  export type AuthenticationPatch = { "backchannel_logout_uri"?: string | null; "entry_methods"?: Array<string>; "min_acr"?: "1" | "mfa" | "mfa-strong" | "phr"; "org_api_enabled"?: boolean; "post_logout_redirect_uris"?: Array<string>; "redirect_uris"?: Array<string>; "require_pkce"?: boolean };
  export type AuthenticationResource = { "application_id": string; "backchannel_logout_uri": string | null; "console_family": boolean; "entry_methods": Array<string>; "min_acr": "1" | "mfa" | "mfa-strong" | "phr"; "org_api_enabled": boolean; "post_logout_redirect_uris": Array<string>; "redirect_uris": Array<string>; "require_pkce": boolean };
  export type Body_assets_account_api_v1_branding_assets_post = { "logo": string };
  export type Body_assets_application_api_v1_applications__application_id__branding_assets_post = { "logo": string };
  export type BoundGrant = { "role_ids": Array<string> };
  export type BrandingResource = { "available_languages"?: Array<string> | null; "configured": Schemas.Theme | null; "contrast": Schemas.Contrast; "effective": Schemas.Theme; "language"?: string | null; "seal"?: Schemas.SealState | null; "sources": Schemas.ThemeSources };
  export type ChannelList = { "items": Array<Schemas.ChannelResource>; "page": Schemas.Page };
  export type ChannelPatch = { "config"?: Schemas.EmailConfig | Schemas.SmsConfig | Schemas.WhatsappConfig; "form"?: "channel" | "assignment"; "monthly_limit"?: number | null; "sender_domain"?: string | null };
  export type ChannelResource = { "check": Schemas.CheckState | null; "configured": Schemas.Configured | null; "effective": Schemas.Effective; "sources": Schemas.Sources; "type": "email" | "sms" | "whatsapp" };
  export type CheckState = { "checked_at": string | null; "last_answer": "present" | "absent" | "unknown" | null; "state": "idle" | "checking" };
  export type ClaimsPut = { "claims": { [key: string]: string } };
  export type ClaimsResource = { "application_id": string; "claims": { [key: string]: string } };
  export type Configured = { "blocked_this_period": number; "config": Schemas.PublicConfig; "created_at": string; "exempt_this_period": number; "form": "channel" | "assignment"; "id": string; "monthly_limit": number | null; "recovery_dependents": number | null; "sender_domain": string | null; "sent_this_period": number; "transport_status": "ok" | "error" | "failing" | null; "transport_status_at": string | null; "transport_status_error": "provider_payment_required" | "delivery_failed" | null; "updated_at": string; "verification": Schemas.api_channels__Verification | null };
  export type ConfirmationErrorResponse = { "confirmation_token": string; "consequence": Schemas.Consequence; "error": Schemas.Error };
  export type ConnectionCreate = { "client_id"?: string | null; "client_secret"?: string; "config": Schemas.EmptyConfig | Schemas.AppleConfig | Schemas.MicrosoftConfig | Schemas.OidcConfig | Schemas.SamlConfig; "display_name"?: string | null; "enabled"?: boolean; "provider": "google" | "apple" | "microsoft" | "github" | "oidc" | "saml"; "provider_key": string };
  export type ConnectionList = { "items": Array<Schemas.ConnectionResource>; "page": Schemas.Page };
  export type ConnectionPatch = { "clear_client_secret"?: boolean; "client_id"?: string | null; "client_secret"?: string; "config"?: Schemas.EmptyConfig | Schemas.AppleConfig | Schemas.MicrosoftConfig | Schemas.OidcConfig | Schemas.SamlConfig; "display_name"?: string | null; "enabled"?: boolean; "provider"?: "google" | "apple" | "microsoft" | "github" | "oidc" | "saml" };
  export type ConnectionResource = { "client_id": string | null; "config": Schemas.EmptyConfig | Schemas.AppleConfig | Schemas.MicrosoftConfig | Schemas.OidcConfig | Schemas.SamlConfig; "created_at": string; "display_name": string | null; "enabled": boolean; "has_client_secret": boolean; "id": string; "organization_id": string | null; "protocol": "oidc" | "oauth2" | "saml"; "provider": "google" | "apple" | "microsoft" | "github" | "oidc" | "saml"; "provider_key": string; "redirect_uris": Array<string>; "updated_at": string };
  export type ConsentLabelsIncompleteErrorResponse = { "error": Schemas.Error; "missing_languages": Array<string> };
  export type ConsentLanguageErrorResponse = { "consent_terms": Array<Schemas.ConsentLanguageTerm>; "error": Schemas.Error };
  export type ConsentLanguageTerm = { "consent_id": string; "key": string; "label": string; "missing_languages": Array<string> };
  export type Consequence = { "display_name": string; "effects": Array<Schemas.Effect>; "resource_id": string; "resource_type": string };
  export type Contact = { "email": string; "pending_email": string | null; "pending_expires_at": string | null; "url": string | null; "verified_at": string | null };
  export type ContactSources = { "contact": Schemas.Source };
  export type ContextActor = { "id": string; "type": "operator" | "tenant_admin" | "m2m" | "monitor" | "org_admin" | "user" };
  export type ContextResource = { "account": Schemas.MinimalResource; "actor": Schemas.ContextActor; "application": Schemas.MinimalResource | null; "capabilities": Array<string>; "organization": Schemas.MinimalResource | null };
  export type Contrast = { "fill_dark": string; "fill_degenerate_dark": boolean; "fill_degenerate_light": boolean; "fill_light": string; "fill_ratio_dark": number; "fill_ratio_light": number; "ring_dark": string; "ring_light": string; "text_dark": string; "text_light": string };
  export type CopyTarget = { "env_file": string | null; "key": string; "label": string; "var_name": string };
  export type DelegatedDomainPatch = { "auto_join_enabled"?: boolean | null; "grant"?: Schemas.BoundGrant | null };
  export type DeliveryList = { "items": Array<Schemas.DeliveryResource>; "page": Schemas.Page };
  export type DeliveryResource = { "application_display_name": string | null; "application_id": string; "attempts": number; "created_at": string; "delivered_at": string | null; "endpoint_id": string; "event_id": string; "id": string; "last_error_code": string | null; "next_attempt_at": string | null; "redacted_at": string | null; "retryable": boolean; "status": "pending" | "delivered" | "exhausted"; "type": string };
  export type DestinationChange = { "url": string };
  export type DnsCheckResource = { "checked_at": string | null; "last_answer": string | null; "state": "idle" | "checking" };
  export type DomainCreate = { "domain": string };
  export type DomainGrant = { "application_id": string; "role_ids": Array<string> };
  export type DomainList = { "items": Array<Schemas.DomainResource>; "page": Schemas.Page };
  export type DomainResource = { "active"?: boolean | null; "application_grants"?: Array<Schemas.DomainGrant> | null; "application_id": string | null; "auto_join_enabled"?: boolean | null; "canonical_host"?: string | null; "check": Schemas.DnsCheckResource; "checked_at": string | null; "created_at": string; "domain": string; "edge"?: string | null; "id": string; "organization_id": string | null; "purpose": "account_name" | "login" | "organization"; "superseded_host"?: string | null; "verification": Schemas.api_domains__Verification; "verification_status": string; "verified_at": string | null };
  export type Effect = { "code": string; "count": number };
  export type Effective = { "form": "channel" | "assignment" | null; "offered": boolean; "rests_on_system": boolean; "sender": string | null; "sender_honored": boolean | null; "templates": { [key: string]: Schemas.JsonValue } | null; "transport_status": "ok" | "error" | "failing" | null };
  export type EffectiveContact = { "email": string | null; "url": string | null };
  export type EmailConfig = { "host"?: string; "password"?: string; "port"?: number; "sender"?: string | null; "username"?: string };
  export type EmailIdentity = { "sender"?: string | null; "sender_domain"?: null };
  export type EmailTestResult = { "blocked_at": "tenant" | "organization" | "client" | "system" | null; "branch": "email"; "channel": Schemas.ChannelResource; "charged": boolean; "error": "delivery_failed" | null; "exempt": boolean; "flow_id": null; "sent": boolean; "verified": null };
  export type Empty = Record<string, unknown>;
  export type EmptyConfig = Record<string, unknown>;
  export type EmptyRequest = Record<string, unknown>;
  export type EnableApplication = { "member_access": "all" | "selected" };
  export type EnabledApplication = { "active": boolean; "application_id": string; "created_at": string; "display_name": string; "invitable": boolean; "invitations_enabled": boolean; "member_access": "all" | "selected"; "organization_id": string; "updated_at": string };
  export type EnabledApplicationList = { "items": Array<Schemas.EnabledApplication>; "page": Schemas.Page };
  export type EndpointCreate = { "application_id": string; "display_name"?: string | null; "enabled"?: boolean; "subscriptions": Array<string>; "url": string };
  export type EndpointList = { "items": Array<Schemas.EndpointResource>; "page": Schemas.Page };
  export type EndpointPatch = { "display_name"?: string | null; "enabled"?: boolean; "subscriptions"?: Array<string> };
  export type EndpointResource = { "application_id": string; "created_at": string; "display_name": string | null; "enabled": boolean; "id": string; "previous_secret_expires_at": string | null; "secret_configured": boolean; "subscriptions": Array<string>; "updated_at": string; "url": string | null };
  export type EntryPatch = { "default_organization_id"?: string | null; "default_role_ids"?: Array<string>; "invitations_enabled"?: boolean; "recovery_methods"?: Array<string>; "require_email_verified"?: boolean; "require_recovery_email"?: boolean; "signup_mode"?: "closed" | "open" | "waitlist"; "signup_rules"?: { [key: string]: Array<string> } };
  export type EntryResource = { "default_organization_id": string | null; "default_role_ids": Array<string>; "entry_immutable": boolean; "id": string; "invitations_enabled": boolean; "recovery_methods": { [key: string]: unknown }; "require_email_verified": boolean; "require_recovery_email": boolean; "requirements": Array<{ [key: string]: unknown }>; "signup_mode": "closed" | "open" | "waitlist"; "signup_rules": { [key: string]: Array<string> } };
  export type Error = { "code": string; "details": Array<Schemas.FieldError>; "message": string; "request_id": string };
  export type ErrorResponse = { "error": Schemas.Error };
  export type EventTypeList = { "items": Array<Schemas.EventTypeResource>; "page": Schemas.Page };
  export type EventTypeResource = { "data_schema": { [key: string]: unknown }; "description_key": string; "type": string };
  export type FieldError = { "code": string; "field": string; "message": string };
  export type FrameworkResource = { "key": string; "label": string };
  export type HTTPValidationError = { "detail"?: Array<Schemas.ValidationError> };
  export type ImpactResource = { "users_affected": number };
  export type InvitationCreate = { "application_id": string; "email": string; "organization_id"?: string | null; "role_ids"?: Array<string> };
  export type InvitationList = { "items": Array<Schemas.InvitationResource>; "page": Schemas.Page };
  export type InvitationResource = { "accepted_at": string | null; "application_display_name": string; "application_id": string; "canceled_at": string | null; "created_at": string; "email": string; "expires_at": string; "id": string; "organization_id": string | null; "role_ids": Array<string>; "status": "pending" | "accepted" | "canceled" | "expired" | "invalid" };
  export type JsonValue = unknown;
  export type LanguagePatch = { "language": string | null };
  export type MembershipCreate = { "administrator"?: boolean; "metadata"?: { [key: string]: unknown }; "user_id": string };
  export type MembershipList = { "items": Array<Schemas.MembershipResource>; "page": Schemas.Page };
  export type MembershipPatch = { "administrator"?: boolean; "metadata"?: { [key: string]: unknown } };
  export type MembershipResource = { "administrator": boolean; "created_at": string; "email": string | null; "metadata": { [key: string]: unknown }; "name": string | null; "organization_id": string; "user_id": string };
  export type MessageApplication = { "display_name": string | null; "id": string };
  export type MessageList = { "items": Array<Schemas.MessageResource>; "page": Schemas.Page };
  export type MessageResource = { "application": Schemas.MessageApplication | null; "application_id": string | null; "attempts": number; "channel_type": "email" | "sms" | "whatsapp"; "created_at": string; "delivered_at": string | null; "expires_at": string | null; "id": string; "last_error_code": "expired" | "redacted" | "provider_payment_required" | null; "next_attempt_at": string | null; "organization_id": string | null; "origin_level": string; "recipient": string | null; "recipient_domain": string | null; "redacted_at": string | null; "status": string; "template": string; "updated_at": string };
  export type MfaResetResult = { "mfa_reset": boolean; "user_id": string };
  export type MicrosoftConfig = { "tenant": string };
  export type MinimalResource = { "display_name": string | null; "id": string };
  export type OidcConfig = { "issuer": string };
  export type OrganizationCreate = { "admin_user_id"?: string | null; "display_name": string };
  export type OrganizationList = { "items": Array<Schemas.OrganizationResource>; "page": Schemas.Page };
  export type OrganizationPatch = { "display_name"?: string };
  export type OrganizationResource = { "created_at": string; "display_name": string; "has_admin": boolean; "id": string; "member_count": number; "updated_at": string };
  export type Page = { "next_cursor": string | null; "total": number | null };
  export type PermissionList = { "items": Array<Schemas.PermissionResource>; "page": Schemas.Page };
  export type PermissionResource = { "id": string; "key": string };
  export type PermissionsPut = { "permissions": Array<string> };
  export type PermissionsResource = { "application_id": string; "permissions": Array<string>; "roles_affected": number };
  export type PhoneConfirm = { "code": string; "flow_id": string; "phone": string };
  export type PhoneConfirmResult = { "blocked_at": null; "branch": "phone_confirm"; "channel": Schemas.ChannelResource; "charged": false; "error": null; "exempt": false; "flow_id": string; "sent": null; "verified": true };
  export type PhoneStart = { "phone": string };
  export type PhoneStartResult = { "blocked_at": null; "branch": "phone_start"; "channel": Schemas.ChannelResource; "charged": false; "error": "delivery_failed" | null; "exempt": false; "flow_id": string | null; "sent": boolean; "verified": null };
  export type PreviewRequest = { "language"?: string | null; "overrides"?: Schemas.Theme | null; "screen": string };
  export type PreviewResponse = { "html": string };
  export type PublicConfig = { "account_sid"?: string | null; "allowed_country_prefixes"?: Array<string> | null; "business_account_id"?: string | null; "from_number"?: string | null; "host"?: string | null; "phone_number_id"?: string | null; "port"?: number | null; "secrets_configured": { [key: string]: boolean }; "sender"?: string | null; "templates"?: { [key: string]: Schemas.JsonValue } | null; "username"?: string | null };
  export type PublishForm = { "document": string; "effective_at"?: string | null; "version"?: number | null };
  export type ReceiptPatch = { "enabled": boolean };
  export type ReceiptResource = { "enabled": boolean };
  export type RecoveryResult = { "expires_in": number; "sent": boolean; "user_id": string };
  export type RetentionPatch = { "consent_retention_years"?: number; "litigation_hold"?: boolean };
  export type RetentionResource = { "consent_retention_years": number; "litigation_hold_at": string | null };
  export type RoleCreate = { "key": string; "label"?: string | null; "min_acr"?: "1" | "mfa" | "mfa-strong" | "phr"; "permission_ids"?: Array<string> };
  export type RoleList = { "items": Array<Schemas.RoleResource>; "page": Schemas.Page };
  export type RolePatch = { "label"?: string | null; "min_acr"?: "1" | "mfa" | "mfa-strong" | "phr"; "permission_ids"?: Array<string> };
  export type RoleResource = { "application_id": string; "created_at": string; "id": string; "key": string; "label": string | null; "min_acr": "1" | "mfa" | "mfa-strong" | "phr"; "permission_ids": Array<string>; "updated_at": string };
  export type RolesPut = { "role_ids": Array<string> };
  export type RotationCreate = { "mode"?: "rotate" | "cut" | "retry" };
  export type SamlConfig = { "certificate": string; "idp_entity_id": string; "sso_url": string };
  export type SealPatch = { "hidden": boolean | null };
  export type SealState = { "declared_at": "product" | "account" | "application" | "organization" | null; "effective_hidden": boolean; "hidden": boolean | null; "plan_default_hidden": boolean; "unlock_requires": { [key: string]: boolean }; "unlocked": boolean };
  export type SelfMembership = { "active": boolean; "organization": Schemas.MinimalResource };
  export type SelfMembershipList = { "items": Array<Schemas.SelfMembership>; "page": Schemas.Page };
  export type SelfUserResource = { "avatar_url": string | null; "display_name": string | null; "email": string | null; "email_verified": boolean; "id": string };
  export type SessionList = { "items": Array<Schemas.SessionResource>; "page": Schemas.Page };
  export type SessionResource = { "authenticated_at": string; "created_at": string; "expires_at": string; "id": string; "last_seen_at": string; "revoked_at": string | null; "user_id": string };
  export type SigningKeyList = { "items": Array<Schemas.SigningKeyResource>; "page": Schemas.Page };
  export type SigningKeyResource = { "alg": string; "created_at": string; "id": string; "kid": string; "public_jwk": { [key: string]: Schemas.JsonValue }; "retired_at": string | null; "rotated_at": string | null; "status": "active" | "retiring" | "retired" };
  export type SmsConfig = { "account_sid"?: string; "allowed_country_prefixes"?: Array<string>; "auth_token"?: string; "from_number"?: string };
  export type Source = { "level": "product" | "account" | "application" | "organization"; "resource_id": string | null };
  export type Sources = { "identity": Schemas.Source | null; "transport": Schemas.Source | null };
  export type StepUpDescriptor = { "endpoint": string; "factors": Array<string>; "header": string; "ttl_s": number };
  export type StepUpErrorResponse = { "capability": string; "error": Schemas.Error; "step_up": Schemas.StepUpDescriptor };
  export type StepUpRequest = { "backup_code"?: string | null; "capability": string; "totp"?: string | null };
  export type api_channels__Verification = { "checked_at": string | null; "record_name": string | null; "record_value": string | null; "sender_domain": string | null; "sender_honored": boolean | null; "status": "unverified" | "pending" | "verified" | "failed"; "verified_at": string | null };
  export type api_domains__Verification = { "record_name": string; "record_value": string | null };
  export type api_webhook_endpoints__RotationResource = { "copy_targets": Array<Schemas.CopyTarget>; "previous_secret_expires_at": string | null; "rotation_id": string; "var_name": string; "webhook_secret": string };
  export type api_webhook_endpoints__SecretResource = { "copy_targets": Array<Schemas.CopyTarget>; "var_name": string; "webhook_secret": string };
  export type application_configuration__RotationResource = { "client_secret": string; "client_secret_prev_expires_at": string | null; "copy_targets": Array<{ [key: string]: string | null }>; "rotation_id": string; "var_name": string };
  export type application_configuration__SecretResource = { "client_secret": string; "copy_targets": Array<{ [key: string]: string | null }>; "var_name": string };
  export type SupportPatch = { "email"?: string; "url"?: string | null };
  export type SupportResource = { "configured": Schemas.Contact | null; "effective": Schemas.EffectiveContact; "sources": Schemas.ContactSources };
  export type TermCreate = { "blocking": boolean; "key": string; "kind"?: "consent" | "declaration"; "labels": { [key: string]: string }; "revocable": boolean; "role"?: "terms" | "privacy" | null };
  export type TermList = { "items": Array<Schemas.TermResource>; "languages": Array<string>; "page": Schemas.Page };
  export type TermMutationResponse = { "application_id": string | null; "blocking": boolean; "created_at": string; "current_version": number | null; "id": string; "key": string; "kind": "consent" | "declaration"; "labels": { [key: string]: string }; "missing_languages": Array<string>; "new_version": number | null; "on_behalf_of": "account" | null; "organization_id": string | null; "pending_after": number; "retired_at": string | null; "revocable": boolean; "role": "terms" | "privacy" | null; "updated_at": string; "users_affected": number };
  export type TermPatch = { "blocking"?: boolean; "labels"?: { [key: string]: string }; "revocable"?: boolean; "role"?: "terms" | "privacy" | null };
  export type TermResource = { "application_id": string | null; "blocking": boolean; "created_at": string; "current_version": number | null; "id": string; "key": string; "kind": "consent" | "declaration"; "labels": { [key: string]: string }; "missing_languages": Array<string>; "on_behalf_of": "account" | null; "organization_id": string | null; "retired_at": string | null; "revocable": boolean; "role": "terms" | "privacy" | null; "updated_at": string };
  export type TestLoginResource = { "authorize_url": string; "expires_at": string; "redirect_uri": string };
  export type TestResource = { "delivery_id": string; "event_id": string };
  export type Theme = { "display_name"?: string | null; "logo_url"?: string | null; "primary_color"?: string | null };
  export type ThemeSources = { "display_name": Schemas.Source | null; "logo_url": Schemas.Source | null; "primary_color": Schemas.Source | null };
  export type TokensPatch = { "access_token_ttl_s"?: number | null; "allowed_scopes"?: Array<string>; "audience"?: string | null; "signing_alg"?: "EdDSA" | "RS256"; "token_endpoint_auth_method"?: "client_secret_basic" | "client_secret_post" | "none" };
  export type TokensResource = { "access_token_ttl_s": number | null; "allowed_scopes": Array<string>; "application_id": string; "audience": string | null; "authorization_endpoint": string; "client_id": string; "client_secret_prev_expires_at": string | null; "client_type": string; "issuer": string; "jwks_uri": string; "last_login_at": string | null; "public": boolean; "secret_configured": boolean; "secret_rotation_overlap_hours": number; "signing_alg": "EdDSA" | "RS256"; "token_endpoint": string; "token_endpoint_auth_method": "client_secret_basic" | "client_secret_post" | "none" };
  export type UserCreate = { "email": string; "email_verified"?: false; "imported_credential"?: string | null; "metadata"?: { [key: string]: unknown }; "name"?: string | null; "password"?: string | null };
  export type UserDeletionResult = { "accounts_without_owner_count": number; "deleted": boolean; "id": string; "organizations_without_admin_count": number };
  export type UserList = { "items": Array<Schemas.UserResource>; "page": Schemas.Page };
  export type UserPatch = { "email_verified"?: false; "metadata"?: { [key: string]: unknown }; "name"?: string | null; "status"?: "active" | "suspended" };
  export type UserResource = { "created_at": string; "email": string; "email_verified": boolean; "id": string; "metadata": { [key: string]: unknown }; "mfa_factors": Array<"totp" | "passkey" | "phone">; "name": string | null; "processing_blocked_at": string | null; "status": "pending" | "active" | "suspended"; "updated_at": string };
  export type UserRevocationResult = { "revoked_count": number; "user_id": string };
  export type ValidationError = { "ctx"?: Record<string, unknown>; "input"?: unknown; "loc": Array<string | number>; "msg": string; "type": string };
  export type VerificationQueued = { "status"?: string };
  export type VersionList = { "items": Array<Schemas.VersionResource>; "page": Schemas.Page };
  export type VersionResource = { "consent_id": string; "document_digest": string; "document_url": string; "effective_at": string | null; "published_at": string; "users_affected": number; "version": number };
  export type WebhookRotationErrorResponse = { "error": Schemas.Error; "previous_secret_expires_at": string };
  export type WhatsappConfig = { "access_token"?: string; "business_account_id"?: string; "phone_number_id"?: string; "templates"?: { [key: string]: Schemas.JsonValue } | null };
  export type WhatsappIdentity = { "templates"?: { [key: string]: Schemas.JsonValue } | null };
}
export class ManagementClient extends ManagementTransport {
  readonly operations = {
    get_account_policy_api_v1_account_policy_get: (args: { options?: WriteOptions } = {}) => this.request<Schemas.AccountPolicyResource>("GET", `/account-policy`, undefined, args.options, undefined),
    patch_account_policy_api_v1_account_policy_patch: (args: { body: Schemas.AccountPolicyPatch; options?: WriteOptions }) => this.request<Schemas.AccountPolicyResource>("PATCH", `/account-policy`, args.body, args.options, undefined),
    list_applications_api_v1_applications_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "client_id"?: string | null; "include_total"?: boolean }; options?: WriteOptions } = {}) => this.request<Schemas.ApplicationList>("GET", `/applications`, undefined, args.options, args.query),
    create_application_api_v1_applications_post: (args: { body: Schemas.ApplicationCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.Application>("POST", `/applications`, args.body, args.options, undefined),
    delete_application_api_v1_applications__application_id__delete: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/applications/${encodeURIComponent(String(args.path["application_id"]))}`, undefined, args.options, undefined),
    get_application_api_v1_applications__application_id__get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.Application>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}`, undefined, args.options, undefined),
    patch_application_api_v1_applications__application_id__patch: (args: { path: { "application_id": string }; body: Schemas.ApplicationPatch; options?: WriteOptions }) => this.request<Schemas.Application>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}`, args.body, args.options, undefined),
    get_agent_instructions_api_v1_applications__application_id__agent_instructions_get: (args: { path: { "application_id": string }; query?: { "framework"?: string }; options?: WriteOptions }) => this.request<Schemas.AgentInstructionsResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/agent-instructions`, undefined, args.options, args.query),
    get_authentication_api_v1_applications__application_id__authentication_get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.AuthenticationResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/authentication`, undefined, args.options, undefined),
    patch_authentication_api_v1_applications__application_id__authentication_patch: (args: { path: { "application_id": string }; body: Schemas.AuthenticationPatch; options?: WriteOptions }) => this.request<Schemas.AuthenticationResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/authentication`, args.body, args.options, undefined),
    get_entry_api_v1_applications__application_id__authentication_entry_get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.EntryResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/authentication/entry`, undefined, args.options, undefined),
    patch_entry_api_v1_applications__application_id__authentication_entry_patch: (args: { path: { "application_id": string }; body: Schemas.EntryPatch; options?: WriteOptions }) => this.request<Schemas.EntryResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/authentication/entry`, args.body, args.options, undefined),
    remove_application_api_v1_applications__application_id__branding_delete: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/branding`, undefined, args.options, undefined),
    read_application_api_v1_applications__application_id__branding_get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.BrandingResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/branding`, undefined, args.options, undefined),
    patch_application_api_v1_applications__application_id__branding_patch: (args: { path: { "application_id": string }; body: Schemas.Theme; options?: WriteOptions }) => this.request<Schemas.BrandingResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/branding`, args.body, args.options, undefined),
    assets_application_api_v1_applications__application_id__branding_assets_post: (args: { path: { "application_id": string }; body: FormData; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.AssetResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/branding/assets`, args.body, args.options, undefined),
    language_application_api_v1_applications__application_id__branding_language_patch: (args: { path: { "application_id": string }; body: Schemas.LanguagePatch; options?: WriteOptions }) => this.request<Schemas.BrandingResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/branding/language`, args.body, args.options, undefined),
    login_preview_application_api_v1_applications__application_id__branding_login_preview_post: (args: { path: { "application_id": string }; body: Schemas.PreviewRequest; options?: WriteOptions }) => this.request<Schemas.PreviewResponse>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/branding/login-preview`, args.body, args.options, undefined),
    seal_application_api_v1_applications__application_id__branding_seal_patch: (args: { path: { "application_id": string }; body: Schemas.SealPatch; options?: WriteOptions }) => this.request<Schemas.BrandingResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/branding/seal`, args.body, args.options, undefined),
    list_application_api_v1_applications__application_id__channels_get: (args: { path: { "application_id": string }; query?: { "limit"?: number; "cursor"?: string | null }; options?: WriteOptions }) => this.request<Schemas.ChannelList>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/channels`, undefined, args.options, args.query),
    remove_application_api_v1_applications__application_id__channels__channel_type__delete: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "application_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, undefined, args.options, undefined),
    read_application_api_v1_applications__application_id__channels__channel_type__get: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "application_id": string }; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, undefined, args.options, undefined),
    patch_application_api_v1_applications__application_id__channels__channel_type__patch: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "application_id": string }; body: Schemas.ChannelPatch; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, args.body, args.options, undefined),
    identity_application_api_v1_applications__application_id__channels__channel_type__identity_patch: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "application_id": string }; body: Schemas.EmailIdentity | Schemas.WhatsappIdentity; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}/identity`, args.body, args.options, undefined),
    test_application_api_v1_applications__application_id__channels__channel_type__test_post: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "application_id": string }; body: Schemas.Empty | Schemas.PhoneStart | Schemas.PhoneConfirm; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.EmailTestResult | Schemas.PhoneStartResult | Schemas.PhoneConfirmResult>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}/test`, args.body, args.options, undefined),
    verify_application_api_v1_applications__application_id__channels__channel_type__verify_post: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "application_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.ChannelResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}/verify`, args.body, args.options, undefined),
    get_claims_api_v1_applications__application_id__claims_get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.ClaimsResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/claims`, undefined, args.options, undefined),
    patch_claims_api_v1_applications__application_id__claims_patch: (args: { path: { "application_id": string }; body: Schemas.ClaimsPut; options?: WriteOptions }) => this.request<Schemas.ClaimsResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/claims`, args.body, args.options, undefined),
    get_receipt_api_v1_applications__application_id__consent_receipt_get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.ReceiptResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consent-receipt`, undefined, args.options, undefined),
    patch_receipt_api_v1_applications__application_id__consent_receipt_patch: (args: { path: { "application_id": string }; body: Schemas.ReceiptPatch; options?: WriteOptions }) => this.request<Schemas.ReceiptResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consent-receipt`, args.body, args.options, undefined),
    app_list_api_v1_applications__application_id__consents_get: (args: { path: { "application_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.TermList>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents`, undefined, args.options, args.query),
    app_create_api_v1_applications__application_id__consents_post: (args: { path: { "application_id": string }; body: Schemas.TermCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.TermResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents`, args.body, args.options, undefined),
    app_retire_api_v1_applications__application_id__consents__consent_id__delete: (args: { path: { "application_id": string; "consent_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}`, undefined, args.options, undefined),
    app_read_api_v1_applications__application_id__consents__consent_id__get: (args: { path: { "application_id": string; "consent_id": string }; options?: WriteOptions }) => this.request<Schemas.TermResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}`, undefined, args.options, undefined),
    app_patch_api_v1_applications__application_id__consents__consent_id__patch: (args: { path: { "application_id": string; "consent_id": string }; body: Schemas.TermPatch; options?: WriteOptions }) => this.request<Schemas.TermMutationResponse>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}`, args.body, args.options, undefined),
    app_impact_api_v1_applications__application_id__consents__consent_id__impact_get: (args: { path: { "application_id": string; "consent_id": string }; options?: WriteOptions }) => this.request<Schemas.ImpactResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/impact`, undefined, args.options, undefined),
    app_versions_api_v1_applications__application_id__consents__consent_id__versions_get: (args: { path: { "application_id": string; "consent_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.VersionList>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/versions`, undefined, args.options, args.query),
    app_publish_api_v1_applications__application_id__consents__consent_id__versions_post: (args: { path: { "application_id": string; "consent_id": string }; body: FormData; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.VersionResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/versions`, args.body, args.options, undefined),
    app_version_api_v1_applications__application_id__consents__consent_id__versions__version__get: (args: { path: { "application_id": string; "consent_id": string; "version": number }; options?: WriteOptions }) => this.request<Schemas.VersionResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/versions/${encodeURIComponent(String(args.path["version"]))}`, undefined, args.options, undefined),
    list_application_domains_api_v1_applications__application_id__domains_get: (args: { path: { "application_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.DomainList>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/domains`, undefined, args.options, args.query),
    create_application_domain_api_v1_applications__application_id__domains_post: (args: { path: { "application_id": string }; body: Schemas.DomainCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.DomainResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/domains`, args.body, args.options, undefined),
    delete_application_domain_api_v1_applications__application_id__domains__domain_id__delete: (args: { path: { "domain_id": string; "application_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/domains/${encodeURIComponent(String(args.path["domain_id"]))}`, undefined, args.options, undefined),
    get_application_domain_api_v1_applications__application_id__domains__domain_id__get: (args: { path: { "domain_id": string; "application_id": string }; options?: WriteOptions }) => this.request<Schemas.DomainResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/domains/${encodeURIComponent(String(args.path["domain_id"]))}`, undefined, args.options, undefined),
    activate_application_domain_api_v1_applications__application_id__domains__domain_id__activate_post: (args: { path: { "application_id": string; "domain_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.DomainResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/domains/${encodeURIComponent(String(args.path["domain_id"]))}/activate`, args.body, args.options, undefined),
    verify_application_domain_api_v1_applications__application_id__domains__domain_id__verify_post: (args: { path: { "domain_id": string; "application_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.DomainResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/domains/${encodeURIComponent(String(args.path["domain_id"]))}/verify`, args.body, args.options, undefined),
    list_permissions_api_v1_applications__application_id__permissions_get: (args: { path: { "application_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.PermissionList>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/permissions`, undefined, args.options, args.query),
    put_permissions_api_v1_applications__application_id__permissions_put: (args: { path: { "application_id": string }; body: Schemas.PermissionsPut; options?: WriteOptions }) => this.request<Schemas.PermissionsResource>("PUT", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/permissions`, args.body, args.options, undefined),
    list_roles_api_v1_applications__application_id__roles_get: (args: { path: { "application_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.RoleList>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/roles`, undefined, args.options, args.query),
    create_role_api_v1_applications__application_id__roles_post: (args: { path: { "application_id": string }; body: Schemas.RoleCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.RoleResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/roles`, args.body, args.options, undefined),
    delete_role_api_v1_applications__application_id__roles__role_id__delete: (args: { path: { "application_id": string; "role_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/roles/${encodeURIComponent(String(args.path["role_id"]))}`, undefined, args.options, undefined),
    get_role_api_v1_applications__application_id__roles__role_id__get: (args: { path: { "application_id": string; "role_id": string }; options?: WriteOptions }) => this.request<Schemas.RoleResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/roles/${encodeURIComponent(String(args.path["role_id"]))}`, undefined, args.options, undefined),
    patch_role_api_v1_applications__application_id__roles__role_id__patch: (args: { path: { "application_id": string; "role_id": string }; body: Schemas.RolePatch; options?: WriteOptions }) => this.request<Schemas.RoleResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/roles/${encodeURIComponent(String(args.path["role_id"]))}`, args.body, args.options, undefined),
    rotate_secret_api_v1_applications__application_id__secret_rotations_post: (args: { path: { "application_id": string }; body: Schemas.RotationCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.application_configuration__RotationResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/secret-rotations`, args.body, args.options, undefined),
    reveal_secret_api_v1_applications__application_id__secret_reveal_post: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.application_configuration__SecretResource>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/secret/reveal`, undefined, args.options, undefined),
    remove_application_api_v1_applications__application_id__support_delete: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/support`, undefined, args.options, undefined),
    read_application_api_v1_applications__application_id__support_get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.SupportResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/support`, undefined, args.options, undefined),
    patch_application_api_v1_applications__application_id__support_patch: (args: { path: { "application_id": string }; body: Schemas.SupportPatch; options?: WriteOptions }) => this.request<Schemas.SupportResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/support`, args.body, args.options, undefined),
    verification_application_api_v1_applications__application_id__support_verification_post: (args: { path: { "application_id": string }; body: Schemas.EmptyRequest; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.VerificationQueued>("POST", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/support/verification`, args.body, args.options, undefined),
    get_test_login_api_v1_applications__application_id__test_login_get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.TestLoginResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/test-login`, undefined, args.options, undefined),
    get_tokens_api_v1_applications__application_id__tokens_get: (args: { path: { "application_id": string }; options?: WriteOptions }) => this.request<Schemas.TokensResource>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/tokens`, undefined, args.options, undefined),
    patch_tokens_api_v1_applications__application_id__tokens_patch: (args: { path: { "application_id": string }; body: Schemas.TokensPatch; options?: WriteOptions }) => this.request<Schemas.TokensResource>("PATCH", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/tokens`, args.body, args.options, undefined),
    delete_user_roles_api_v1_applications__application_id__users__user_id__roles_delete: (args: { path: { "application_id": string; "user_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/users/${encodeURIComponent(String(args.path["user_id"]))}/roles`, undefined, args.options, undefined),
    get_user_roles_api_v1_applications__application_id__users__user_id__roles_get: (args: { path: { "application_id": string; "user_id": string }; options?: WriteOptions }) => this.request<Schemas.AssignedAccess>("GET", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/users/${encodeURIComponent(String(args.path["user_id"]))}/roles`, undefined, args.options, undefined),
    put_user_roles_api_v1_applications__application_id__users__user_id__roles_put: (args: { path: { "application_id": string; "user_id": string }; body: Schemas.RolesPut; options?: WriteOptions }) => this.request<Schemas.AssignedAccess>("PUT", `/applications/${encodeURIComponent(String(args.path["application_id"]))}/users/${encodeURIComponent(String(args.path["user_id"]))}/roles`, args.body, args.options, undefined),
    audit_events_api_v1_audit_events_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean; "actor"?: string | null; "action"?: string | null; "organization_id"?: string | null }; options?: WriteOptions } = {}) => this.request<Schemas.AuditEventList>("GET", `/audit-events`, undefined, args.options, args.query),
    remove_account_api_v1_branding_delete: (args: { options?: WriteOptions } = {}) => this.request<void>("DELETE", `/branding`, undefined, args.options, undefined),
    read_account_api_v1_branding_get: (args: { options?: WriteOptions } = {}) => this.request<Schemas.BrandingResource>("GET", `/branding`, undefined, args.options, undefined),
    patch_account_api_v1_branding_patch: (args: { body: Schemas.Theme; options?: WriteOptions }) => this.request<Schemas.BrandingResource>("PATCH", `/branding`, args.body, args.options, undefined),
    assets_account_api_v1_branding_assets_post: (args: { body: FormData; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.AssetResource>("POST", `/branding/assets`, args.body, args.options, undefined),
    login_preview_account_api_v1_branding_login_preview_post: (args: { body: Schemas.PreviewRequest; options?: WriteOptions }) => this.request<Schemas.PreviewResponse>("POST", `/branding/login-preview`, args.body, args.options, undefined),
    seal_account_api_v1_branding_seal_patch: (args: { body: Schemas.SealPatch; options?: WriteOptions }) => this.request<Schemas.BrandingResource>("PATCH", `/branding/seal`, args.body, args.options, undefined),
    list_account_api_v1_channels_get: (args: { query?: { "limit"?: number; "cursor"?: string | null }; options?: WriteOptions } = {}) => this.request<Schemas.ChannelList>("GET", `/channels`, undefined, args.options, args.query),
    remove_account_api_v1_channels__channel_type__delete: (args: { path: { "channel_type": "email" | "sms" | "whatsapp" }; options?: WriteOptions }) => this.request<void>("DELETE", `/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, undefined, args.options, undefined),
    read_account_api_v1_channels__channel_type__get: (args: { path: { "channel_type": "email" | "sms" | "whatsapp" }; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("GET", `/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, undefined, args.options, undefined),
    patch_account_api_v1_channels__channel_type__patch: (args: { path: { "channel_type": "email" | "sms" | "whatsapp" }; body: Schemas.ChannelPatch; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("PATCH", `/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, args.body, args.options, undefined),
    identity_account_api_v1_channels__channel_type__identity_patch: (args: { path: { "channel_type": "email" | "sms" | "whatsapp" }; body: Schemas.EmailIdentity | Schemas.WhatsappIdentity; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("PATCH", `/channels/${encodeURIComponent(String(args.path["channel_type"]))}/identity`, args.body, args.options, undefined),
    test_account_api_v1_channels__channel_type__test_post: (args: { path: { "channel_type": "email" | "sms" | "whatsapp" }; body: Schemas.Empty | Schemas.PhoneStart | Schemas.PhoneConfirm; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.EmailTestResult | Schemas.PhoneStartResult | Schemas.PhoneConfirmResult>("POST", `/channels/${encodeURIComponent(String(args.path["channel_type"]))}/test`, args.body, args.options, undefined),
    verify_account_api_v1_channels__channel_type__verify_post: (args: { path: { "channel_type": "email" | "sms" | "whatsapp" }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.ChannelResource>("POST", `/channels/${encodeURIComponent(String(args.path["channel_type"]))}/verify`, args.body, args.options, undefined),
    list_connections_api_v1_connections_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean; "provider"?: "google" | "apple" | "microsoft" | "github" | "oidc" | "saml" | null }; options?: WriteOptions } = {}) => this.request<Schemas.ConnectionList>("GET", `/connections`, undefined, args.options, args.query),
    create_connection_api_v1_connections_post: (args: { body: Schemas.ConnectionCreate; options?: WriteOptions }) => this.request<Schemas.ConnectionResource>("POST", `/connections`, args.body, args.options, undefined),
    delete_connection_api_v1_connections__connection_id__delete: (args: { path: { "connection_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/connections/${encodeURIComponent(String(args.path["connection_id"]))}`, undefined, args.options, undefined),
    get_connection_api_v1_connections__connection_id__get: (args: { path: { "connection_id": string }; options?: WriteOptions }) => this.request<Schemas.ConnectionResource>("GET", `/connections/${encodeURIComponent(String(args.path["connection_id"]))}`, undefined, args.options, undefined),
    patch_connection_api_v1_connections__connection_id__patch: (args: { path: { "connection_id": string }; body: Schemas.ConnectionPatch; options?: WriteOptions }) => this.request<Schemas.ConnectionResource>("PATCH", `/connections/${encodeURIComponent(String(args.path["connection_id"]))}`, args.body, args.options, undefined),
    get_acts_api_v1_consent_acts_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean; "subject_id"?: string | null; "application_id"?: string | null; "organization_id"?: string | null; "key"?: string | null; "version"?: number | null; "decision"?: "accepted" | "declined" | null; "scope"?: "application" | "organization" | null; "email"?: string | null }; options?: WriteOptions } = {}) => this.request<Schemas.ActList>("GET", `/consent-acts`, undefined, args.options, args.query),
    get_act_api_v1_consent_acts__act_id__get: (args: { path: { "act_id": string }; options?: WriteOptions }) => this.request<Schemas.ActResource>("GET", `/consent-acts/${encodeURIComponent(String(args.path["act_id"]))}`, undefined, args.options, undefined),
    revoke_act_api_v1_consent_acts__act_id__revoke_post: (args: { path: { "act_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.ActResource>("POST", `/consent-acts/${encodeURIComponent(String(args.path["act_id"]))}/revoke`, args.body, args.options, undefined),
    get_document_api_v1_consent_documents__digest__get: (args: { path: { "digest": string }; options?: WriteOptions }) => this.request<Uint8Array>("GET", `/consent-documents/${encodeURIComponent(String(args.path["digest"]))}`, undefined, { ...args.options, responseType: "bytes" }, undefined),
    get_retention_api_v1_consent_retention_get: (args: { options?: WriteOptions } = {}) => this.request<Schemas.RetentionResource>("GET", `/consent-retention`, undefined, args.options, undefined),
    patch_retention_api_v1_consent_retention_patch: (args: { body: Schemas.RetentionPatch; options?: WriteOptions }) => this.request<Schemas.RetentionResource>("PATCH", `/consent-retention`, args.body, args.options, undefined),
    credential_context_api_v1_context_get: (args: { options?: WriteOptions } = {}) => this.request<Schemas.ContextResource>("GET", `/context`, undefined, args.options, undefined),
    list_account_domains_api_v1_domains_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions } = {}) => this.request<Schemas.DomainList>("GET", `/domains`, undefined, args.options, args.query),
    create_account_domain_api_v1_domains_post: (args: { body: Schemas.DomainCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.DomainResource>("POST", `/domains`, args.body, args.options, undefined),
    delete_account_domain_api_v1_domains__domain_id__delete: (args: { path: { "domain_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/domains/${encodeURIComponent(String(args.path["domain_id"]))}`, undefined, args.options, undefined),
    get_account_domain_api_v1_domains__domain_id__get: (args: { path: { "domain_id": string }; options?: WriteOptions }) => this.request<Schemas.DomainResource>("GET", `/domains/${encodeURIComponent(String(args.path["domain_id"]))}`, undefined, args.options, undefined),
    verify_account_domain_api_v1_domains__domain_id__verify_post: (args: { path: { "domain_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.DomainResource>("POST", `/domains/${encodeURIComponent(String(args.path["domain_id"]))}/verify`, args.body, args.options, undefined),
    list_invitations_api_v1_invitations_get: (args: { query?: { "organization_id"?: string | null; "application_id"?: string | null; "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions } = {}) => this.request<Schemas.InvitationList>("GET", `/invitations`, undefined, args.options, args.query),
    create_invitation_api_v1_invitations_post: (args: { body: Schemas.InvitationCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.InvitationResource>("POST", `/invitations`, args.body, args.options, undefined),
    cancel_invitation_api_v1_invitations__invitation_id__delete: (args: { path: { "invitation_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/invitations/${encodeURIComponent(String(args.path["invitation_id"]))}`, undefined, args.options, undefined),
    get_invitation_api_v1_invitations__invitation_id__get: (args: { path: { "invitation_id": string }; options?: WriteOptions }) => this.request<Schemas.InvitationResource>("GET", `/invitations/${encodeURIComponent(String(args.path["invitation_id"]))}`, undefined, args.options, undefined),
    resend_invitation_api_v1_invitations__invitation_id__resend_post: (args: { path: { "invitation_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.InvitationResource>("POST", `/invitations/${encodeURIComponent(String(args.path["invitation_id"]))}/resend`, undefined, args.options, undefined),
    self_user_api_v1_me_get: (args: { options?: WriteOptions } = {}) => this.request<Schemas.SelfUserResource>("GET", `/me`, undefined, args.options, undefined),
    self_memberships_api_v1_me_memberships_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions } = {}) => this.request<Schemas.SelfMembershipList>("GET", `/me/memberships`, undefined, args.options, args.query),
    list_messages_api_v1_messages_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean; "channel_type"?: "email" | "sms" | "whatsapp" | null; "organization_id"?: string | null; "application_id"?: string | null; "status"?: string | null; "recipient"?: string | null }; options?: WriteOptions } = {}) => this.request<Schemas.MessageList>("GET", `/messages`, undefined, args.options, args.query),
    get_policy_api_v1_organization_admin_policy_get: (args: { options?: WriteOptions } = {}) => this.request<Schemas.AdministrativePolicy>("GET", `/organization-admin-policy`, undefined, args.options, undefined),
    patch_policy_api_v1_organization_admin_policy_patch: (args: { body: Schemas.AdministrativePolicyPatch; options?: WriteOptions }) => this.request<Schemas.AdministrativePolicy>("PATCH", `/organization-admin-policy`, args.body, args.options, undefined),
    list_organizations_api_v1_organizations_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean; "without_admin"?: boolean }; options?: WriteOptions } = {}) => this.request<Schemas.OrganizationList>("GET", `/organizations`, undefined, args.options, args.query),
    create_organization_api_v1_organizations_post: (args: { body: Schemas.OrganizationCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.OrganizationResource>("POST", `/organizations`, args.body, args.options, undefined),
    delete_organization_api_v1_organizations__organization_id__delete: (args: { path: { "organization_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}`, undefined, args.options, undefined),
    get_organization_api_v1_organizations__organization_id__get: (args: { path: { "organization_id": string }; options?: WriteOptions }) => this.request<Schemas.OrganizationResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}`, undefined, args.options, undefined),
    patch_organization_api_v1_organizations__organization_id__patch: (args: { path: { "organization_id": string }; body: Schemas.OrganizationPatch; options?: WriteOptions }) => this.request<Schemas.OrganizationResource>("PATCH", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}`, args.body, args.options, undefined),
    list_enabled_applications_api_v1_organizations__organization_id__applications_get: (args: { path: { "organization_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.EnabledApplicationList>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications`, undefined, args.options, args.query),
    disable_application_api_v1_organizations__organization_id__applications__application_id__delete: (args: { path: { "organization_id": string; "application_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications/${encodeURIComponent(String(args.path["application_id"]))}`, undefined, args.options, undefined),
    get_enabled_application_api_v1_organizations__organization_id__applications__application_id__get: (args: { path: { "organization_id": string; "application_id": string }; options?: WriteOptions }) => this.request<Schemas.EnabledApplication>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications/${encodeURIComponent(String(args.path["application_id"]))}`, undefined, args.options, undefined),
    enable_application_api_v1_organizations__organization_id__applications__application_id__put: (args: { path: { "organization_id": string; "application_id": string }; body: Schemas.EnableApplication; options?: WriteOptions }) => this.request<Schemas.EnabledApplication>("PUT", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications/${encodeURIComponent(String(args.path["application_id"]))}`, args.body, args.options, undefined),
    delete_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__delete: (args: { path: { "organization_id": string; "application_id": string; "user_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications/${encodeURIComponent(String(args.path["application_id"]))}/members/${encodeURIComponent(String(args.path["user_id"]))}`, undefined, args.options, undefined),
    get_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__get: (args: { path: { "organization_id": string; "application_id": string; "user_id": string }; options?: WriteOptions }) => this.request<Schemas.AssignedAccess>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications/${encodeURIComponent(String(args.path["application_id"]))}/members/${encodeURIComponent(String(args.path["user_id"]))}`, undefined, args.options, undefined),
    put_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__put: (args: { path: { "organization_id": string; "application_id": string; "user_id": string }; body: Schemas.RolesPut; options?: WriteOptions }) => this.request<Schemas.AssignedAccess>("PUT", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications/${encodeURIComponent(String(args.path["application_id"]))}/members/${encodeURIComponent(String(args.path["user_id"]))}`, args.body, args.options, undefined),
    list_organization_application_roles_api_v1_organizations__organization_id__applications__application_id__roles_get: (args: { path: { "organization_id": string; "application_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.RoleList>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications/${encodeURIComponent(String(args.path["application_id"]))}/roles`, undefined, args.options, args.query),
    remove_organization_api_v1_organizations__organization_id__branding_delete: (args: { path: { "organization_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/branding`, undefined, args.options, undefined),
    read_organization_api_v1_organizations__organization_id__branding_get: (args: { path: { "organization_id": string }; options?: WriteOptions }) => this.request<Schemas.BrandingResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/branding`, undefined, args.options, undefined),
    patch_organization_api_v1_organizations__organization_id__branding_patch: (args: { path: { "organization_id": string }; body: Schemas.Theme; options?: WriteOptions }) => this.request<Schemas.BrandingResource>("PATCH", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/branding`, args.body, args.options, undefined),
    list_organization_api_v1_organizations__organization_id__channels_get: (args: { path: { "organization_id": string }; query?: { "limit"?: number; "cursor"?: string | null }; options?: WriteOptions }) => this.request<Schemas.ChannelList>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/channels`, undefined, args.options, args.query),
    remove_organization_api_v1_organizations__organization_id__channels__channel_type__delete: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "organization_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, undefined, args.options, undefined),
    read_organization_api_v1_organizations__organization_id__channels__channel_type__get: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "organization_id": string }; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, undefined, args.options, undefined),
    patch_organization_api_v1_organizations__organization_id__channels__channel_type__patch: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "organization_id": string }; body: Schemas.ChannelPatch; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("PATCH", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}`, args.body, args.options, undefined),
    identity_organization_api_v1_organizations__organization_id__channels__channel_type__identity_patch: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "organization_id": string }; body: Schemas.EmailIdentity | Schemas.WhatsappIdentity; options?: WriteOptions }) => this.request<Schemas.ChannelResource>("PATCH", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}/identity`, args.body, args.options, undefined),
    test_organization_api_v1_organizations__organization_id__channels__channel_type__test_post: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "organization_id": string }; body: Schemas.Empty | Schemas.PhoneStart | Schemas.PhoneConfirm; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.EmailTestResult | Schemas.PhoneStartResult | Schemas.PhoneConfirmResult>("POST", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}/test`, args.body, args.options, undefined),
    verify_organization_api_v1_organizations__organization_id__channels__channel_type__verify_post: (args: { path: { "channel_type": "email" | "sms" | "whatsapp"; "organization_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.ChannelResource>("POST", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/channels/${encodeURIComponent(String(args.path["channel_type"]))}/verify`, args.body, args.options, undefined),
    list_org_connections_api_v1_organizations__organization_id__connections_get: (args: { path: { "organization_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean; "provider"?: "google" | "apple" | "microsoft" | "github" | "oidc" | "saml" | null }; options?: WriteOptions }) => this.request<Schemas.ConnectionList>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/connections`, undefined, args.options, args.query),
    create_org_connection_api_v1_organizations__organization_id__connections_post: (args: { path: { "organization_id": string }; body: Schemas.ConnectionCreate; options?: WriteOptions }) => this.request<Schemas.ConnectionResource>("POST", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/connections`, args.body, args.options, undefined),
    delete_org_connection_api_v1_organizations__organization_id__connections__connection_id__delete: (args: { path: { "organization_id": string; "connection_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/connections/${encodeURIComponent(String(args.path["connection_id"]))}`, undefined, args.options, undefined),
    get_org_connection_api_v1_organizations__organization_id__connections__connection_id__get: (args: { path: { "organization_id": string; "connection_id": string }; options?: WriteOptions }) => this.request<Schemas.ConnectionResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/connections/${encodeURIComponent(String(args.path["connection_id"]))}`, undefined, args.options, undefined),
    patch_org_connection_api_v1_organizations__organization_id__connections__connection_id__patch: (args: { path: { "organization_id": string; "connection_id": string }; body: Schemas.ConnectionPatch; options?: WriteOptions }) => this.request<Schemas.ConnectionResource>("PATCH", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/connections/${encodeURIComponent(String(args.path["connection_id"]))}`, args.body, args.options, undefined),
    org_list_api_v1_organizations__organization_id__consents_get: (args: { path: { "organization_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.TermList>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents`, undefined, args.options, args.query),
    org_create_api_v1_organizations__organization_id__consents_post: (args: { path: { "organization_id": string }; body: Schemas.TermCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.TermResource>("POST", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents`, args.body, args.options, undefined),
    org_retire_api_v1_organizations__organization_id__consents__consent_id__delete: (args: { path: { "organization_id": string; "consent_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}`, undefined, args.options, undefined),
    org_read_api_v1_organizations__organization_id__consents__consent_id__get: (args: { path: { "organization_id": string; "consent_id": string }; options?: WriteOptions }) => this.request<Schemas.TermResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}`, undefined, args.options, undefined),
    org_patch_api_v1_organizations__organization_id__consents__consent_id__patch: (args: { path: { "organization_id": string; "consent_id": string }; body: Schemas.TermPatch; options?: WriteOptions }) => this.request<Schemas.TermMutationResponse>("PATCH", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}`, args.body, args.options, undefined),
    org_impact_api_v1_organizations__organization_id__consents__consent_id__impact_get: (args: { path: { "organization_id": string; "consent_id": string }; options?: WriteOptions }) => this.request<Schemas.ImpactResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/impact`, undefined, args.options, undefined),
    org_versions_api_v1_organizations__organization_id__consents__consent_id__versions_get: (args: { path: { "organization_id": string; "consent_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.VersionList>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/versions`, undefined, args.options, args.query),
    org_publish_api_v1_organizations__organization_id__consents__consent_id__versions_post: (args: { path: { "organization_id": string; "consent_id": string }; body: FormData; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.VersionResource>("POST", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/versions`, args.body, args.options, undefined),
    org_version_api_v1_organizations__organization_id__consents__consent_id__versions__version__get: (args: { path: { "organization_id": string; "consent_id": string; "version": number }; options?: WriteOptions }) => this.request<Schemas.VersionResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/versions/${encodeURIComponent(String(args.path["version"]))}`, undefined, args.options, undefined),
    list_organization_domains_api_v1_organizations__organization_id__domains_get: (args: { path: { "organization_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.DomainList>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/domains`, undefined, args.options, args.query),
    create_organization_domain_api_v1_organizations__organization_id__domains_post: (args: { path: { "organization_id": string }; body: Schemas.DomainCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.DomainResource>("POST", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/domains`, args.body, args.options, undefined),
    delete_organization_domain_api_v1_organizations__organization_id__domains__domain_id__delete: (args: { path: { "domain_id": string; "organization_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/domains/${encodeURIComponent(String(args.path["domain_id"]))}`, undefined, args.options, undefined),
    get_organization_domain_api_v1_organizations__organization_id__domains__domain_id__get: (args: { path: { "domain_id": string; "organization_id": string }; options?: WriteOptions }) => this.request<Schemas.DomainResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/domains/${encodeURIComponent(String(args.path["domain_id"]))}`, undefined, args.options, undefined),
    patch_organization_domain_api_v1_organizations__organization_id__domains__domain_id__patch: (args: { path: { "organization_id": string; "domain_id": string }; body: Schemas.AccountDomainPatch | Schemas.DelegatedDomainPatch; options?: WriteOptions }) => this.request<Schemas.DomainResource>("PATCH", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/domains/${encodeURIComponent(String(args.path["domain_id"]))}`, args.body, args.options, undefined),
    verify_organization_domain_api_v1_organizations__organization_id__domains__domain_id__verify_post: (args: { path: { "domain_id": string; "organization_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.DomainResource>("POST", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/domains/${encodeURIComponent(String(args.path["domain_id"]))}/verify`, args.body, args.options, undefined),
    list_memberships_api_v1_organizations__organization_id__memberships_get: (args: { path: { "organization_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean; "administrator"?: boolean | null }; options?: WriteOptions }) => this.request<Schemas.MembershipList>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/memberships`, undefined, args.options, args.query),
    create_membership_api_v1_organizations__organization_id__memberships_post: (args: { path: { "organization_id": string }; body: Schemas.MembershipCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.MembershipResource>("POST", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/memberships`, args.body, args.options, undefined),
    delete_membership_api_v1_organizations__organization_id__memberships__user_id__delete: (args: { path: { "organization_id": string; "user_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/memberships/${encodeURIComponent(String(args.path["user_id"]))}`, undefined, args.options, undefined),
    get_membership_api_v1_organizations__organization_id__memberships__user_id__get: (args: { path: { "organization_id": string; "user_id": string }; options?: WriteOptions }) => this.request<Schemas.MembershipResource>("GET", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/memberships/${encodeURIComponent(String(args.path["user_id"]))}`, undefined, args.options, undefined),
    patch_membership_api_v1_organizations__organization_id__memberships__user_id__patch: (args: { path: { "organization_id": string; "user_id": string }; body: Schemas.MembershipPatch; options?: WriteOptions }) => this.request<Schemas.MembershipResource>("PATCH", `/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/memberships/${encodeURIComponent(String(args.path["user_id"]))}`, args.body, args.options, undefined),
    get_keys_api_v1_signing_keys_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions } = {}) => this.request<Schemas.SigningKeyList>("GET", `/signing-keys`, undefined, args.options, args.query),
    request_step_up_api_v1_step_up_post: (args: { body: Schemas.StepUpRequest; options?: WriteOptions }) => this.request<{ [key: string]: unknown }>("POST", `/step-up`, args.body, args.options, undefined),
    remove_account_api_v1_support_delete: (args: { options?: WriteOptions } = {}) => this.request<void>("DELETE", `/support`, undefined, args.options, undefined),
    read_account_api_v1_support_get: (args: { options?: WriteOptions } = {}) => this.request<Schemas.SupportResource>("GET", `/support`, undefined, args.options, undefined),
    patch_account_api_v1_support_patch: (args: { body: Schemas.SupportPatch; options?: WriteOptions }) => this.request<Schemas.SupportResource>("PATCH", `/support`, args.body, args.options, undefined),
    verification_account_api_v1_support_verification_post: (args: { body: Schemas.EmptyRequest; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.VerificationQueued>("POST", `/support/verification`, args.body, args.options, undefined),
    list_users_api_v1_users_get: (args: { query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean; "status"?: "pending" | "active" | "suspended" | null; "mfa"?: "none" | "missing_required" | null; "q"?: string | null }; options?: WriteOptions } = {}) => this.request<Schemas.UserList>("GET", `/users`, undefined, args.options, args.query),
    create_user_api_v1_users_post: (args: { body: Schemas.UserCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.UserResource>("POST", `/users`, args.body, args.options, undefined),
    delete_user_api_v1_users__user_id__delete: (args: { path: { "user_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.UserDeletionResult>("DELETE", `/users/${encodeURIComponent(String(args.path["user_id"]))}`, undefined, args.options, undefined),
    get_user_api_v1_users__user_id__get: (args: { path: { "user_id": string }; options?: WriteOptions }) => this.request<Schemas.UserResource>("GET", `/users/${encodeURIComponent(String(args.path["user_id"]))}`, undefined, args.options, undefined),
    patch_user_api_v1_users__user_id__patch: (args: { path: { "user_id": string }; body: Schemas.UserPatch; options?: WriteOptions }) => this.request<Schemas.UserResource>("PATCH", `/users/${encodeURIComponent(String(args.path["user_id"]))}`, args.body, args.options, undefined),
    approve_user_api_v1_users__user_id__approve_post: (args: { path: { "user_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.UserResource>("POST", `/users/${encodeURIComponent(String(args.path["user_id"]))}/approve`, undefined, args.options, undefined),
    export_user_api_v1_users__user_id__export_get: (args: { path: { "user_id": string }; options?: WriteOptions }) => this.request<unknown>("GET", `/users/${encodeURIComponent(String(args.path["user_id"]))}/export`, undefined, args.options, undefined),
    list_user_memberships_api_v1_users__user_id__memberships_get: (args: { path: { "user_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.MembershipList>("GET", `/users/${encodeURIComponent(String(args.path["user_id"]))}/memberships`, undefined, args.options, args.query),
    reset_mfa_api_v1_users__user_id__mfa_reset_post: (args: { path: { "user_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.MfaResetResult>("POST", `/users/${encodeURIComponent(String(args.path["user_id"]))}/mfa/reset`, undefined, args.options, undefined),
    unblock_processing_api_v1_users__user_id__processing_block_delete: (args: { path: { "user_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.UserResource>("DELETE", `/users/${encodeURIComponent(String(args.path["user_id"]))}/processing-block`, undefined, args.options, undefined),
    block_processing_api_v1_users__user_id__processing_block_post: (args: { path: { "user_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.UserResource>("POST", `/users/${encodeURIComponent(String(args.path["user_id"]))}/processing-block`, undefined, args.options, undefined),
    issue_recovery_api_v1_users__user_id__recovery_post: (args: { path: { "user_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.RecoveryResult>("POST", `/users/${encodeURIComponent(String(args.path["user_id"]))}/recovery`, undefined, args.options, undefined),
    reject_user_api_v1_users__user_id__reject_post: (args: { path: { "user_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.UserDeletionResult>("POST", `/users/${encodeURIComponent(String(args.path["user_id"]))}/reject`, undefined, args.options, undefined),
    list_sessions_api_v1_users__user_id__sessions_get: (args: { path: { "user_id": string }; query?: { "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.SessionList>("GET", `/users/${encodeURIComponent(String(args.path["user_id"]))}/sessions`, undefined, args.options, args.query),
    delete_session_api_v1_users__user_id__sessions__session_id__delete: (args: { path: { "user_id": string; "session_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/users/${encodeURIComponent(String(args.path["user_id"]))}/sessions/${encodeURIComponent(String(args.path["session_id"]))}`, undefined, args.options, undefined),
    get_session_api_v1_users__user_id__sessions__session_id__get: (args: { path: { "user_id": string; "session_id": string }; options?: WriteOptions }) => this.request<Schemas.SessionResource>("GET", `/users/${encodeURIComponent(String(args.path["user_id"]))}/sessions/${encodeURIComponent(String(args.path["session_id"]))}`, undefined, args.options, undefined),
    revoke_user_sessions_api_v1_users__user_id__sessions_revoke_post: (args: { path: { "user_id": string }; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.UserRevocationResult>("POST", `/users/${encodeURIComponent(String(args.path["user_id"]))}/sessions/revoke`, undefined, args.options, undefined),
    list_deliveries_api_v1_webhook_deliveries_get: (args: { query?: { "application_id"?: string | null; "endpoint_id"?: string | null; "type"?: string | null; "status"?: "pending" | "delivered" | "exhausted" | null; "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions } = {}) => this.request<Schemas.DeliveryList>("GET", `/webhook-deliveries`, undefined, args.options, args.query),
    get_delivery_api_v1_webhook_deliveries__delivery_id__get: (args: { path: { "delivery_id": string }; options?: WriteOptions }) => this.request<Schemas.DeliveryResource>("GET", `/webhook-deliveries/${encodeURIComponent(String(args.path["delivery_id"]))}`, undefined, args.options, undefined),
    retry_delivery_api_v1_webhook_deliveries__delivery_id__retry_post: (args: { path: { "delivery_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.DeliveryResource>("POST", `/webhook-deliveries/${encodeURIComponent(String(args.path["delivery_id"]))}/retry`, args.body, args.options, undefined),
    list_endpoints_api_v1_webhook_endpoints_get: (args: { query?: { "application_id"?: string | null; "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions } = {}) => this.request<Schemas.EndpointList>("GET", `/webhook-endpoints`, undefined, args.options, args.query),
    create_endpoint_api_v1_webhook_endpoints_post: (args: { body: Schemas.EndpointCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.EndpointResource>("POST", `/webhook-endpoints`, args.body, args.options, undefined),
    delete_endpoint_api_v1_webhook_endpoints__endpoint_id__delete: (args: { path: { "endpoint_id": string }; options?: WriteOptions }) => this.request<void>("DELETE", `/webhook-endpoints/${encodeURIComponent(String(args.path["endpoint_id"]))}`, undefined, args.options, undefined),
    get_endpoint_api_v1_webhook_endpoints__endpoint_id__get: (args: { path: { "endpoint_id": string }; options?: WriteOptions }) => this.request<Schemas.EndpointResource>("GET", `/webhook-endpoints/${encodeURIComponent(String(args.path["endpoint_id"]))}`, undefined, args.options, undefined),
    patch_endpoint_api_v1_webhook_endpoints__endpoint_id__patch: (args: { path: { "endpoint_id": string }; body: Schemas.EndpointPatch; options?: WriteOptions }) => this.request<Schemas.EndpointResource>("PATCH", `/webhook-endpoints/${encodeURIComponent(String(args.path["endpoint_id"]))}`, args.body, args.options, undefined),
    change_destination_api_v1_webhook_endpoints__endpoint_id__destination_changes_post: (args: { path: { "endpoint_id": string }; body: Schemas.DestinationChange; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.api_webhook_endpoints__RotationResource>("POST", `/webhook-endpoints/${encodeURIComponent(String(args.path["endpoint_id"]))}/destination-changes`, args.body, args.options, undefined),
    rotate_endpoint_api_v1_webhook_endpoints__endpoint_id__secret_rotations_post: (args: { path: { "endpoint_id": string }; body: Schemas.RotationCreate; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.api_webhook_endpoints__RotationResource>("POST", `/webhook-endpoints/${encodeURIComponent(String(args.path["endpoint_id"]))}/secret-rotations`, args.body, args.options, undefined),
    reveal_endpoint_api_v1_webhook_endpoints__endpoint_id__secret_reveal_post: (args: { path: { "endpoint_id": string }; body: Schemas.Empty; options?: WriteOptions }) => this.request<Schemas.api_webhook_endpoints__SecretResource>("POST", `/webhook-endpoints/${encodeURIComponent(String(args.path["endpoint_id"]))}/secret/reveal`, args.body, args.options, undefined),
    test_endpoint_api_v1_webhook_endpoints__endpoint_id__test_post: (args: { path: { "endpoint_id": string }; body: Schemas.Empty; options: WriteOptions & Required<Pick<WriteOptions, "idempotencyKey">> }) => this.request<Schemas.TestResource>("POST", `/webhook-endpoints/${encodeURIComponent(String(args.path["endpoint_id"]))}/test`, args.body, args.options, undefined),
    event_types_api_v1_webhook_event_types_get: (args: { query: { "application_id": string; "limit"?: number; "cursor"?: string | null; "include_total"?: boolean }; options?: WriteOptions }) => this.request<Schemas.EventTypeList>("GET", `/webhook-event-types`, undefined, args.options, args.query),
  };
  readonly accountPolicy = {
    get: (...args: Parameters<ManagementClient["operations"]["get_account_policy_api_v1_account_policy_get"]>) => this.operations.get_account_policy_api_v1_account_policy_get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_account_policy_api_v1_account_policy_patch"]>) => this.operations.patch_account_policy_api_v1_account_policy_patch(...args),
  };
  readonly applications = {
    list: (...args: Parameters<ManagementClient["operations"]["list_applications_api_v1_applications_get"]>) => this.operations.list_applications_api_v1_applications_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_applications_api_v1_applications_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.Application) => string | number } = {}) => this.iterate<Schemas.Application>(`/applications`, args.query, args.identity),
    create: (...args: Parameters<ManagementClient["operations"]["create_application_api_v1_applications_post"]>) => this.operations.create_application_api_v1_applications_post(...args),
    delete: (...args: Parameters<ManagementClient["operations"]["delete_application_api_v1_applications__application_id__delete"]>) => this.operations.delete_application_api_v1_applications__application_id__delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["get_application_api_v1_applications__application_id__get"]>) => this.operations.get_application_api_v1_applications__application_id__get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_application_api_v1_applications__application_id__patch"]>) => this.operations.patch_application_api_v1_applications__application_id__patch(...args),
    agentInstructions: {
      get: (...args: Parameters<ManagementClient["operations"]["get_agent_instructions_api_v1_applications__application_id__agent_instructions_get"]>) => this.operations.get_agent_instructions_api_v1_applications__application_id__agent_instructions_get(...args),
    },
    authentication: {
      get: (...args: Parameters<ManagementClient["operations"]["get_authentication_api_v1_applications__application_id__authentication_get"]>) => this.operations.get_authentication_api_v1_applications__application_id__authentication_get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_authentication_api_v1_applications__application_id__authentication_patch"]>) => this.operations.patch_authentication_api_v1_applications__application_id__authentication_patch(...args),
      entry: {
        get: (...args: Parameters<ManagementClient["operations"]["get_entry_api_v1_applications__application_id__authentication_entry_get"]>) => this.operations.get_entry_api_v1_applications__application_id__authentication_entry_get(...args),
        update: (...args: Parameters<ManagementClient["operations"]["patch_entry_api_v1_applications__application_id__authentication_entry_patch"]>) => this.operations.patch_entry_api_v1_applications__application_id__authentication_entry_patch(...args),
      },
    },
    branding: {
      delete: (...args: Parameters<ManagementClient["operations"]["remove_application_api_v1_applications__application_id__branding_delete"]>) => this.operations.remove_application_api_v1_applications__application_id__branding_delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["read_application_api_v1_applications__application_id__branding_get"]>) => this.operations.read_application_api_v1_applications__application_id__branding_get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_application_api_v1_applications__application_id__branding_patch"]>) => this.operations.patch_application_api_v1_applications__application_id__branding_patch(...args),
      assets: {
        create: (...args: Parameters<ManagementClient["operations"]["assets_application_api_v1_applications__application_id__branding_assets_post"]>) => this.operations.assets_application_api_v1_applications__application_id__branding_assets_post(...args),
      },
      language: {
        update: (...args: Parameters<ManagementClient["operations"]["language_application_api_v1_applications__application_id__branding_language_patch"]>) => this.operations.language_application_api_v1_applications__application_id__branding_language_patch(...args),
      },
      loginPreview: {
        create: (...args: Parameters<ManagementClient["operations"]["login_preview_application_api_v1_applications__application_id__branding_login_preview_post"]>) => this.operations.login_preview_application_api_v1_applications__application_id__branding_login_preview_post(...args),
      },
      seal: {
        update: (...args: Parameters<ManagementClient["operations"]["seal_application_api_v1_applications__application_id__branding_seal_patch"]>) => this.operations.seal_application_api_v1_applications__application_id__branding_seal_patch(...args),
      },
    },
    channels: {
      list: (...args: Parameters<ManagementClient["operations"]["list_application_api_v1_applications__application_id__channels_get"]>) => this.operations.list_application_api_v1_applications__application_id__channels_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_application_api_v1_applications__application_id__channels_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.ChannelResource) => string | number }) => this.iterate<Schemas.ChannelResource>(`/applications/${encodeURIComponent(String(args.path["application_id"]))}/channels`, args.query, args.identity),
      delete: (...args: Parameters<ManagementClient["operations"]["remove_application_api_v1_applications__application_id__channels__channel_type__delete"]>) => this.operations.remove_application_api_v1_applications__application_id__channels__channel_type__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["read_application_api_v1_applications__application_id__channels__channel_type__get"]>) => this.operations.read_application_api_v1_applications__application_id__channels__channel_type__get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_application_api_v1_applications__application_id__channels__channel_type__patch"]>) => this.operations.patch_application_api_v1_applications__application_id__channels__channel_type__patch(...args),
      identity: {
        update: (...args: Parameters<ManagementClient["operations"]["identity_application_api_v1_applications__application_id__channels__channel_type__identity_patch"]>) => this.operations.identity_application_api_v1_applications__application_id__channels__channel_type__identity_patch(...args),
      },
      test: {
        create: (...args: Parameters<ManagementClient["operations"]["test_application_api_v1_applications__application_id__channels__channel_type__test_post"]>) => this.operations.test_application_api_v1_applications__application_id__channels__channel_type__test_post(...args),
      },
      verify: {
        create: (...args: Parameters<ManagementClient["operations"]["verify_application_api_v1_applications__application_id__channels__channel_type__verify_post"]>) => this.operations.verify_application_api_v1_applications__application_id__channels__channel_type__verify_post(...args),
      },
    },
    claims: {
      get: (...args: Parameters<ManagementClient["operations"]["get_claims_api_v1_applications__application_id__claims_get"]>) => this.operations.get_claims_api_v1_applications__application_id__claims_get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_claims_api_v1_applications__application_id__claims_patch"]>) => this.operations.patch_claims_api_v1_applications__application_id__claims_patch(...args),
    },
    consentReceipt: {
      get: (...args: Parameters<ManagementClient["operations"]["get_receipt_api_v1_applications__application_id__consent_receipt_get"]>) => this.operations.get_receipt_api_v1_applications__application_id__consent_receipt_get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_receipt_api_v1_applications__application_id__consent_receipt_patch"]>) => this.operations.patch_receipt_api_v1_applications__application_id__consent_receipt_patch(...args),
    },
    consents: {
      list: (...args: Parameters<ManagementClient["operations"]["app_list_api_v1_applications__application_id__consents_get"]>) => this.operations.app_list_api_v1_applications__application_id__consents_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["app_list_api_v1_applications__application_id__consents_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.TermResource) => string | number }) => this.iterate<Schemas.TermResource>(`/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents`, args.query, args.identity),
      create: (...args: Parameters<ManagementClient["operations"]["app_create_api_v1_applications__application_id__consents_post"]>) => this.operations.app_create_api_v1_applications__application_id__consents_post(...args),
      delete: (...args: Parameters<ManagementClient["operations"]["app_retire_api_v1_applications__application_id__consents__consent_id__delete"]>) => this.operations.app_retire_api_v1_applications__application_id__consents__consent_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["app_read_api_v1_applications__application_id__consents__consent_id__get"]>) => this.operations.app_read_api_v1_applications__application_id__consents__consent_id__get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["app_patch_api_v1_applications__application_id__consents__consent_id__patch"]>) => this.operations.app_patch_api_v1_applications__application_id__consents__consent_id__patch(...args),
      impact: {
        get: (...args: Parameters<ManagementClient["operations"]["app_impact_api_v1_applications__application_id__consents__consent_id__impact_get"]>) => this.operations.app_impact_api_v1_applications__application_id__consents__consent_id__impact_get(...args),
      },
      versions: {
        list: (...args: Parameters<ManagementClient["operations"]["app_versions_api_v1_applications__application_id__consents__consent_id__versions_get"]>) => this.operations.app_versions_api_v1_applications__application_id__consents__consent_id__versions_get(...args),
        iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["app_versions_api_v1_applications__application_id__consents__consent_id__versions_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.VersionResource) => string | number }) => this.iterate<Schemas.VersionResource>(`/applications/${encodeURIComponent(String(args.path["application_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/versions`, args.query, args.identity),
        create: (...args: Parameters<ManagementClient["operations"]["app_publish_api_v1_applications__application_id__consents__consent_id__versions_post"]>) => this.operations.app_publish_api_v1_applications__application_id__consents__consent_id__versions_post(...args),
        get: (...args: Parameters<ManagementClient["operations"]["app_version_api_v1_applications__application_id__consents__consent_id__versions__version__get"]>) => this.operations.app_version_api_v1_applications__application_id__consents__consent_id__versions__version__get(...args),
      },
    },
    domains: {
      list: (...args: Parameters<ManagementClient["operations"]["list_application_domains_api_v1_applications__application_id__domains_get"]>) => this.operations.list_application_domains_api_v1_applications__application_id__domains_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_application_domains_api_v1_applications__application_id__domains_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.DomainResource) => string | number }) => this.iterate<Schemas.DomainResource>(`/applications/${encodeURIComponent(String(args.path["application_id"]))}/domains`, args.query, args.identity),
      create: (...args: Parameters<ManagementClient["operations"]["create_application_domain_api_v1_applications__application_id__domains_post"]>) => this.operations.create_application_domain_api_v1_applications__application_id__domains_post(...args),
      delete: (...args: Parameters<ManagementClient["operations"]["delete_application_domain_api_v1_applications__application_id__domains__domain_id__delete"]>) => this.operations.delete_application_domain_api_v1_applications__application_id__domains__domain_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["get_application_domain_api_v1_applications__application_id__domains__domain_id__get"]>) => this.operations.get_application_domain_api_v1_applications__application_id__domains__domain_id__get(...args),
      activate: {
        create: (...args: Parameters<ManagementClient["operations"]["activate_application_domain_api_v1_applications__application_id__domains__domain_id__activate_post"]>) => this.operations.activate_application_domain_api_v1_applications__application_id__domains__domain_id__activate_post(...args),
      },
      verify: {
        create: (...args: Parameters<ManagementClient["operations"]["verify_application_domain_api_v1_applications__application_id__domains__domain_id__verify_post"]>) => this.operations.verify_application_domain_api_v1_applications__application_id__domains__domain_id__verify_post(...args),
      },
    },
    permissions: {
      list: (...args: Parameters<ManagementClient["operations"]["list_permissions_api_v1_applications__application_id__permissions_get"]>) => this.operations.list_permissions_api_v1_applications__application_id__permissions_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_permissions_api_v1_applications__application_id__permissions_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.PermissionResource) => string | number }) => this.iterate<Schemas.PermissionResource>(`/applications/${encodeURIComponent(String(args.path["application_id"]))}/permissions`, args.query, args.identity),
      replace: (...args: Parameters<ManagementClient["operations"]["put_permissions_api_v1_applications__application_id__permissions_put"]>) => this.operations.put_permissions_api_v1_applications__application_id__permissions_put(...args),
    },
    roles: {
      list: (...args: Parameters<ManagementClient["operations"]["list_roles_api_v1_applications__application_id__roles_get"]>) => this.operations.list_roles_api_v1_applications__application_id__roles_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_roles_api_v1_applications__application_id__roles_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.RoleResource) => string | number }) => this.iterate<Schemas.RoleResource>(`/applications/${encodeURIComponent(String(args.path["application_id"]))}/roles`, args.query, args.identity),
      create: (...args: Parameters<ManagementClient["operations"]["create_role_api_v1_applications__application_id__roles_post"]>) => this.operations.create_role_api_v1_applications__application_id__roles_post(...args),
      delete: (...args: Parameters<ManagementClient["operations"]["delete_role_api_v1_applications__application_id__roles__role_id__delete"]>) => this.operations.delete_role_api_v1_applications__application_id__roles__role_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["get_role_api_v1_applications__application_id__roles__role_id__get"]>) => this.operations.get_role_api_v1_applications__application_id__roles__role_id__get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_role_api_v1_applications__application_id__roles__role_id__patch"]>) => this.operations.patch_role_api_v1_applications__application_id__roles__role_id__patch(...args),
    },
    secret: {
      reveal: {
        create: (...args: Parameters<ManagementClient["operations"]["reveal_secret_api_v1_applications__application_id__secret_reveal_post"]>) => this.operations.reveal_secret_api_v1_applications__application_id__secret_reveal_post(...args),
      },
    },
    secretRotations: {
      create: (...args: Parameters<ManagementClient["operations"]["rotate_secret_api_v1_applications__application_id__secret_rotations_post"]>) => this.operations.rotate_secret_api_v1_applications__application_id__secret_rotations_post(...args),
    },
    support: {
      delete: (...args: Parameters<ManagementClient["operations"]["remove_application_api_v1_applications__application_id__support_delete"]>) => this.operations.remove_application_api_v1_applications__application_id__support_delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["read_application_api_v1_applications__application_id__support_get"]>) => this.operations.read_application_api_v1_applications__application_id__support_get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_application_api_v1_applications__application_id__support_patch"]>) => this.operations.patch_application_api_v1_applications__application_id__support_patch(...args),
      verification: {
        create: (...args: Parameters<ManagementClient["operations"]["verification_application_api_v1_applications__application_id__support_verification_post"]>) => this.operations.verification_application_api_v1_applications__application_id__support_verification_post(...args),
      },
    },
    testLogin: {
      get: (...args: Parameters<ManagementClient["operations"]["get_test_login_api_v1_applications__application_id__test_login_get"]>) => this.operations.get_test_login_api_v1_applications__application_id__test_login_get(...args),
    },
    tokens: {
      get: (...args: Parameters<ManagementClient["operations"]["get_tokens_api_v1_applications__application_id__tokens_get"]>) => this.operations.get_tokens_api_v1_applications__application_id__tokens_get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_tokens_api_v1_applications__application_id__tokens_patch"]>) => this.operations.patch_tokens_api_v1_applications__application_id__tokens_patch(...args),
    },
    users: {
      roles: {
        delete: (...args: Parameters<ManagementClient["operations"]["delete_user_roles_api_v1_applications__application_id__users__user_id__roles_delete"]>) => this.operations.delete_user_roles_api_v1_applications__application_id__users__user_id__roles_delete(...args),
        get: (...args: Parameters<ManagementClient["operations"]["get_user_roles_api_v1_applications__application_id__users__user_id__roles_get"]>) => this.operations.get_user_roles_api_v1_applications__application_id__users__user_id__roles_get(...args),
        replace: (...args: Parameters<ManagementClient["operations"]["put_user_roles_api_v1_applications__application_id__users__user_id__roles_put"]>) => this.operations.put_user_roles_api_v1_applications__application_id__users__user_id__roles_put(...args),
      },
    },
  };
  readonly auditEvents = {
    list: (...args: Parameters<ManagementClient["operations"]["audit_events_api_v1_audit_events_get"]>) => this.operations.audit_events_api_v1_audit_events_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["audit_events_api_v1_audit_events_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.AuditEventResource) => string | number } = {}) => this.iterate<Schemas.AuditEventResource>(`/audit-events`, args.query, args.identity),
  };
  readonly branding = {
    delete: (...args: Parameters<ManagementClient["operations"]["remove_account_api_v1_branding_delete"]>) => this.operations.remove_account_api_v1_branding_delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["read_account_api_v1_branding_get"]>) => this.operations.read_account_api_v1_branding_get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_account_api_v1_branding_patch"]>) => this.operations.patch_account_api_v1_branding_patch(...args),
    assets: {
      create: (...args: Parameters<ManagementClient["operations"]["assets_account_api_v1_branding_assets_post"]>) => this.operations.assets_account_api_v1_branding_assets_post(...args),
    },
    loginPreview: {
      create: (...args: Parameters<ManagementClient["operations"]["login_preview_account_api_v1_branding_login_preview_post"]>) => this.operations.login_preview_account_api_v1_branding_login_preview_post(...args),
    },
    seal: {
      update: (...args: Parameters<ManagementClient["operations"]["seal_account_api_v1_branding_seal_patch"]>) => this.operations.seal_account_api_v1_branding_seal_patch(...args),
    },
  };
  readonly channels = {
    list: (...args: Parameters<ManagementClient["operations"]["list_account_api_v1_channels_get"]>) => this.operations.list_account_api_v1_channels_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_account_api_v1_channels_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.ChannelResource) => string | number }) => this.iterate<Schemas.ChannelResource>(`/channels`, args.query, args.identity),
    delete: (...args: Parameters<ManagementClient["operations"]["remove_account_api_v1_channels__channel_type__delete"]>) => this.operations.remove_account_api_v1_channels__channel_type__delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["read_account_api_v1_channels__channel_type__get"]>) => this.operations.read_account_api_v1_channels__channel_type__get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_account_api_v1_channels__channel_type__patch"]>) => this.operations.patch_account_api_v1_channels__channel_type__patch(...args),
    identity: {
      update: (...args: Parameters<ManagementClient["operations"]["identity_account_api_v1_channels__channel_type__identity_patch"]>) => this.operations.identity_account_api_v1_channels__channel_type__identity_patch(...args),
    },
    test: {
      create: (...args: Parameters<ManagementClient["operations"]["test_account_api_v1_channels__channel_type__test_post"]>) => this.operations.test_account_api_v1_channels__channel_type__test_post(...args),
    },
    verify: {
      create: (...args: Parameters<ManagementClient["operations"]["verify_account_api_v1_channels__channel_type__verify_post"]>) => this.operations.verify_account_api_v1_channels__channel_type__verify_post(...args),
    },
  };
  readonly connections = {
    list: (...args: Parameters<ManagementClient["operations"]["list_connections_api_v1_connections_get"]>) => this.operations.list_connections_api_v1_connections_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_connections_api_v1_connections_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.ConnectionResource) => string | number } = {}) => this.iterate<Schemas.ConnectionResource>(`/connections`, args.query, args.identity),
    create: (...args: Parameters<ManagementClient["operations"]["create_connection_api_v1_connections_post"]>) => this.operations.create_connection_api_v1_connections_post(...args),
    delete: (...args: Parameters<ManagementClient["operations"]["delete_connection_api_v1_connections__connection_id__delete"]>) => this.operations.delete_connection_api_v1_connections__connection_id__delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["get_connection_api_v1_connections__connection_id__get"]>) => this.operations.get_connection_api_v1_connections__connection_id__get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_connection_api_v1_connections__connection_id__patch"]>) => this.operations.patch_connection_api_v1_connections__connection_id__patch(...args),
  };
  readonly consentActs = {
    list: (...args: Parameters<ManagementClient["operations"]["get_acts_api_v1_consent_acts_get"]>) => this.operations.get_acts_api_v1_consent_acts_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["get_acts_api_v1_consent_acts_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.ActResource) => string | number } = {}) => this.iterate<Schemas.ActResource>(`/consent-acts`, args.query, args.identity),
    get: (...args: Parameters<ManagementClient["operations"]["get_act_api_v1_consent_acts__act_id__get"]>) => this.operations.get_act_api_v1_consent_acts__act_id__get(...args),
    revoke: {
      create: (...args: Parameters<ManagementClient["operations"]["revoke_act_api_v1_consent_acts__act_id__revoke_post"]>) => this.operations.revoke_act_api_v1_consent_acts__act_id__revoke_post(...args),
    },
  };
  readonly consentDocuments = {
    get: (...args: Parameters<ManagementClient["operations"]["get_document_api_v1_consent_documents__digest__get"]>) => this.operations.get_document_api_v1_consent_documents__digest__get(...args),
  };
  readonly consentRetention = {
    get: (...args: Parameters<ManagementClient["operations"]["get_retention_api_v1_consent_retention_get"]>) => this.operations.get_retention_api_v1_consent_retention_get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_retention_api_v1_consent_retention_patch"]>) => this.operations.patch_retention_api_v1_consent_retention_patch(...args),
  };
  readonly context = {
    get: (...args: Parameters<ManagementClient["operations"]["credential_context_api_v1_context_get"]>) => this.operations.credential_context_api_v1_context_get(...args),
  };
  readonly domains = {
    list: (...args: Parameters<ManagementClient["operations"]["list_account_domains_api_v1_domains_get"]>) => this.operations.list_account_domains_api_v1_domains_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_account_domains_api_v1_domains_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.DomainResource) => string | number } = {}) => this.iterate<Schemas.DomainResource>(`/domains`, args.query, args.identity),
    create: (...args: Parameters<ManagementClient["operations"]["create_account_domain_api_v1_domains_post"]>) => this.operations.create_account_domain_api_v1_domains_post(...args),
    delete: (...args: Parameters<ManagementClient["operations"]["delete_account_domain_api_v1_domains__domain_id__delete"]>) => this.operations.delete_account_domain_api_v1_domains__domain_id__delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["get_account_domain_api_v1_domains__domain_id__get"]>) => this.operations.get_account_domain_api_v1_domains__domain_id__get(...args),
    verify: {
      create: (...args: Parameters<ManagementClient["operations"]["verify_account_domain_api_v1_domains__domain_id__verify_post"]>) => this.operations.verify_account_domain_api_v1_domains__domain_id__verify_post(...args),
    },
  };
  readonly invitations = {
    list: (...args: Parameters<ManagementClient["operations"]["list_invitations_api_v1_invitations_get"]>) => this.operations.list_invitations_api_v1_invitations_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_invitations_api_v1_invitations_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.InvitationResource) => string | number } = {}) => this.iterate<Schemas.InvitationResource>(`/invitations`, args.query, args.identity),
    create: (...args: Parameters<ManagementClient["operations"]["create_invitation_api_v1_invitations_post"]>) => this.operations.create_invitation_api_v1_invitations_post(...args),
    delete: (...args: Parameters<ManagementClient["operations"]["cancel_invitation_api_v1_invitations__invitation_id__delete"]>) => this.operations.cancel_invitation_api_v1_invitations__invitation_id__delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["get_invitation_api_v1_invitations__invitation_id__get"]>) => this.operations.get_invitation_api_v1_invitations__invitation_id__get(...args),
    resend: {
      create: (...args: Parameters<ManagementClient["operations"]["resend_invitation_api_v1_invitations__invitation_id__resend_post"]>) => this.operations.resend_invitation_api_v1_invitations__invitation_id__resend_post(...args),
    },
  };
  readonly me = {
    get: (...args: Parameters<ManagementClient["operations"]["self_user_api_v1_me_get"]>) => this.operations.self_user_api_v1_me_get(...args),
    memberships: {
      list: (...args: Parameters<ManagementClient["operations"]["self_memberships_api_v1_me_memberships_get"]>) => this.operations.self_memberships_api_v1_me_memberships_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["self_memberships_api_v1_me_memberships_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.SelfMembership) => string | number }) => this.iterate<Schemas.SelfMembership>(`/me/memberships`, args.query, args.identity),
    },
  };
  readonly messages = {
    list: (...args: Parameters<ManagementClient["operations"]["list_messages_api_v1_messages_get"]>) => this.operations.list_messages_api_v1_messages_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_messages_api_v1_messages_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.MessageResource) => string | number } = {}) => this.iterate<Schemas.MessageResource>(`/messages`, args.query, args.identity),
  };
  readonly organizationAdminPolicy = {
    get: (...args: Parameters<ManagementClient["operations"]["get_policy_api_v1_organization_admin_policy_get"]>) => this.operations.get_policy_api_v1_organization_admin_policy_get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_policy_api_v1_organization_admin_policy_patch"]>) => this.operations.patch_policy_api_v1_organization_admin_policy_patch(...args),
  };
  readonly organizations = {
    list: (...args: Parameters<ManagementClient["operations"]["list_organizations_api_v1_organizations_get"]>) => this.operations.list_organizations_api_v1_organizations_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_organizations_api_v1_organizations_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.OrganizationResource) => string | number } = {}) => this.iterate<Schemas.OrganizationResource>(`/organizations`, args.query, args.identity),
    create: (...args: Parameters<ManagementClient["operations"]["create_organization_api_v1_organizations_post"]>) => this.operations.create_organization_api_v1_organizations_post(...args),
    delete: (...args: Parameters<ManagementClient["operations"]["delete_organization_api_v1_organizations__organization_id__delete"]>) => this.operations.delete_organization_api_v1_organizations__organization_id__delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["get_organization_api_v1_organizations__organization_id__get"]>) => this.operations.get_organization_api_v1_organizations__organization_id__get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_organization_api_v1_organizations__organization_id__patch"]>) => this.operations.patch_organization_api_v1_organizations__organization_id__patch(...args),
    applications: {
      list: (...args: Parameters<ManagementClient["operations"]["list_enabled_applications_api_v1_organizations__organization_id__applications_get"]>) => this.operations.list_enabled_applications_api_v1_organizations__organization_id__applications_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_enabled_applications_api_v1_organizations__organization_id__applications_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.EnabledApplication) => string | number }) => this.iterate<Schemas.EnabledApplication>(`/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications`, args.query, args.identity),
      delete: (...args: Parameters<ManagementClient["operations"]["disable_application_api_v1_organizations__organization_id__applications__application_id__delete"]>) => this.operations.disable_application_api_v1_organizations__organization_id__applications__application_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["get_enabled_application_api_v1_organizations__organization_id__applications__application_id__get"]>) => this.operations.get_enabled_application_api_v1_organizations__organization_id__applications__application_id__get(...args),
      replace: (...args: Parameters<ManagementClient["operations"]["enable_application_api_v1_organizations__organization_id__applications__application_id__put"]>) => this.operations.enable_application_api_v1_organizations__organization_id__applications__application_id__put(...args),
      members: {
        delete: (...args: Parameters<ManagementClient["operations"]["delete_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__delete"]>) => this.operations.delete_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__delete(...args),
        get: (...args: Parameters<ManagementClient["operations"]["get_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__get"]>) => this.operations.get_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__get(...args),
        replace: (...args: Parameters<ManagementClient["operations"]["put_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__put"]>) => this.operations.put_member_access_api_v1_organizations__organization_id__applications__application_id__members__user_id__put(...args),
      },
      roles: {
        list: (...args: Parameters<ManagementClient["operations"]["list_organization_application_roles_api_v1_organizations__organization_id__applications__application_id__roles_get"]>) => this.operations.list_organization_application_roles_api_v1_organizations__organization_id__applications__application_id__roles_get(...args),
        iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_organization_application_roles_api_v1_organizations__organization_id__applications__application_id__roles_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.RoleResource) => string | number }) => this.iterate<Schemas.RoleResource>(`/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/applications/${encodeURIComponent(String(args.path["application_id"]))}/roles`, args.query, args.identity),
      },
    },
    branding: {
      delete: (...args: Parameters<ManagementClient["operations"]["remove_organization_api_v1_organizations__organization_id__branding_delete"]>) => this.operations.remove_organization_api_v1_organizations__organization_id__branding_delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["read_organization_api_v1_organizations__organization_id__branding_get"]>) => this.operations.read_organization_api_v1_organizations__organization_id__branding_get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_organization_api_v1_organizations__organization_id__branding_patch"]>) => this.operations.patch_organization_api_v1_organizations__organization_id__branding_patch(...args),
    },
    channels: {
      list: (...args: Parameters<ManagementClient["operations"]["list_organization_api_v1_organizations__organization_id__channels_get"]>) => this.operations.list_organization_api_v1_organizations__organization_id__channels_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_organization_api_v1_organizations__organization_id__channels_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.ChannelResource) => string | number }) => this.iterate<Schemas.ChannelResource>(`/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/channels`, args.query, args.identity),
      delete: (...args: Parameters<ManagementClient["operations"]["remove_organization_api_v1_organizations__organization_id__channels__channel_type__delete"]>) => this.operations.remove_organization_api_v1_organizations__organization_id__channels__channel_type__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["read_organization_api_v1_organizations__organization_id__channels__channel_type__get"]>) => this.operations.read_organization_api_v1_organizations__organization_id__channels__channel_type__get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_organization_api_v1_organizations__organization_id__channels__channel_type__patch"]>) => this.operations.patch_organization_api_v1_organizations__organization_id__channels__channel_type__patch(...args),
      identity: {
        update: (...args: Parameters<ManagementClient["operations"]["identity_organization_api_v1_organizations__organization_id__channels__channel_type__identity_patch"]>) => this.operations.identity_organization_api_v1_organizations__organization_id__channels__channel_type__identity_patch(...args),
      },
      test: {
        create: (...args: Parameters<ManagementClient["operations"]["test_organization_api_v1_organizations__organization_id__channels__channel_type__test_post"]>) => this.operations.test_organization_api_v1_organizations__organization_id__channels__channel_type__test_post(...args),
      },
      verify: {
        create: (...args: Parameters<ManagementClient["operations"]["verify_organization_api_v1_organizations__organization_id__channels__channel_type__verify_post"]>) => this.operations.verify_organization_api_v1_organizations__organization_id__channels__channel_type__verify_post(...args),
      },
    },
    connections: {
      list: (...args: Parameters<ManagementClient["operations"]["list_org_connections_api_v1_organizations__organization_id__connections_get"]>) => this.operations.list_org_connections_api_v1_organizations__organization_id__connections_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_org_connections_api_v1_organizations__organization_id__connections_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.ConnectionResource) => string | number }) => this.iterate<Schemas.ConnectionResource>(`/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/connections`, args.query, args.identity),
      create: (...args: Parameters<ManagementClient["operations"]["create_org_connection_api_v1_organizations__organization_id__connections_post"]>) => this.operations.create_org_connection_api_v1_organizations__organization_id__connections_post(...args),
      delete: (...args: Parameters<ManagementClient["operations"]["delete_org_connection_api_v1_organizations__organization_id__connections__connection_id__delete"]>) => this.operations.delete_org_connection_api_v1_organizations__organization_id__connections__connection_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["get_org_connection_api_v1_organizations__organization_id__connections__connection_id__get"]>) => this.operations.get_org_connection_api_v1_organizations__organization_id__connections__connection_id__get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_org_connection_api_v1_organizations__organization_id__connections__connection_id__patch"]>) => this.operations.patch_org_connection_api_v1_organizations__organization_id__connections__connection_id__patch(...args),
    },
    consents: {
      list: (...args: Parameters<ManagementClient["operations"]["org_list_api_v1_organizations__organization_id__consents_get"]>) => this.operations.org_list_api_v1_organizations__organization_id__consents_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["org_list_api_v1_organizations__organization_id__consents_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.TermResource) => string | number }) => this.iterate<Schemas.TermResource>(`/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents`, args.query, args.identity),
      create: (...args: Parameters<ManagementClient["operations"]["org_create_api_v1_organizations__organization_id__consents_post"]>) => this.operations.org_create_api_v1_organizations__organization_id__consents_post(...args),
      delete: (...args: Parameters<ManagementClient["operations"]["org_retire_api_v1_organizations__organization_id__consents__consent_id__delete"]>) => this.operations.org_retire_api_v1_organizations__organization_id__consents__consent_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["org_read_api_v1_organizations__organization_id__consents__consent_id__get"]>) => this.operations.org_read_api_v1_organizations__organization_id__consents__consent_id__get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["org_patch_api_v1_organizations__organization_id__consents__consent_id__patch"]>) => this.operations.org_patch_api_v1_organizations__organization_id__consents__consent_id__patch(...args),
      impact: {
        get: (...args: Parameters<ManagementClient["operations"]["org_impact_api_v1_organizations__organization_id__consents__consent_id__impact_get"]>) => this.operations.org_impact_api_v1_organizations__organization_id__consents__consent_id__impact_get(...args),
      },
      versions: {
        list: (...args: Parameters<ManagementClient["operations"]["org_versions_api_v1_organizations__organization_id__consents__consent_id__versions_get"]>) => this.operations.org_versions_api_v1_organizations__organization_id__consents__consent_id__versions_get(...args),
        iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["org_versions_api_v1_organizations__organization_id__consents__consent_id__versions_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.VersionResource) => string | number }) => this.iterate<Schemas.VersionResource>(`/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/consents/${encodeURIComponent(String(args.path["consent_id"]))}/versions`, args.query, args.identity),
        create: (...args: Parameters<ManagementClient["operations"]["org_publish_api_v1_organizations__organization_id__consents__consent_id__versions_post"]>) => this.operations.org_publish_api_v1_organizations__organization_id__consents__consent_id__versions_post(...args),
        get: (...args: Parameters<ManagementClient["operations"]["org_version_api_v1_organizations__organization_id__consents__consent_id__versions__version__get"]>) => this.operations.org_version_api_v1_organizations__organization_id__consents__consent_id__versions__version__get(...args),
      },
    },
    domains: {
      list: (...args: Parameters<ManagementClient["operations"]["list_organization_domains_api_v1_organizations__organization_id__domains_get"]>) => this.operations.list_organization_domains_api_v1_organizations__organization_id__domains_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_organization_domains_api_v1_organizations__organization_id__domains_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.DomainResource) => string | number }) => this.iterate<Schemas.DomainResource>(`/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/domains`, args.query, args.identity),
      create: (...args: Parameters<ManagementClient["operations"]["create_organization_domain_api_v1_organizations__organization_id__domains_post"]>) => this.operations.create_organization_domain_api_v1_organizations__organization_id__domains_post(...args),
      delete: (...args: Parameters<ManagementClient["operations"]["delete_organization_domain_api_v1_organizations__organization_id__domains__domain_id__delete"]>) => this.operations.delete_organization_domain_api_v1_organizations__organization_id__domains__domain_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["get_organization_domain_api_v1_organizations__organization_id__domains__domain_id__get"]>) => this.operations.get_organization_domain_api_v1_organizations__organization_id__domains__domain_id__get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_organization_domain_api_v1_organizations__organization_id__domains__domain_id__patch"]>) => this.operations.patch_organization_domain_api_v1_organizations__organization_id__domains__domain_id__patch(...args),
      verify: {
        create: (...args: Parameters<ManagementClient["operations"]["verify_organization_domain_api_v1_organizations__organization_id__domains__domain_id__verify_post"]>) => this.operations.verify_organization_domain_api_v1_organizations__organization_id__domains__domain_id__verify_post(...args),
      },
    },
    memberships: {
      list: (...args: Parameters<ManagementClient["operations"]["list_memberships_api_v1_organizations__organization_id__memberships_get"]>) => this.operations.list_memberships_api_v1_organizations__organization_id__memberships_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_memberships_api_v1_organizations__organization_id__memberships_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.MembershipResource) => string | number }) => this.iterate<Schemas.MembershipResource>(`/organizations/${encodeURIComponent(String(args.path["organization_id"]))}/memberships`, args.query, args.identity),
      create: (...args: Parameters<ManagementClient["operations"]["create_membership_api_v1_organizations__organization_id__memberships_post"]>) => this.operations.create_membership_api_v1_organizations__organization_id__memberships_post(...args),
      delete: (...args: Parameters<ManagementClient["operations"]["delete_membership_api_v1_organizations__organization_id__memberships__user_id__delete"]>) => this.operations.delete_membership_api_v1_organizations__organization_id__memberships__user_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["get_membership_api_v1_organizations__organization_id__memberships__user_id__get"]>) => this.operations.get_membership_api_v1_organizations__organization_id__memberships__user_id__get(...args),
      update: (...args: Parameters<ManagementClient["operations"]["patch_membership_api_v1_organizations__organization_id__memberships__user_id__patch"]>) => this.operations.patch_membership_api_v1_organizations__organization_id__memberships__user_id__patch(...args),
    },
  };
  readonly signingKeys = {
    list: (...args: Parameters<ManagementClient["operations"]["get_keys_api_v1_signing_keys_get"]>) => this.operations.get_keys_api_v1_signing_keys_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["get_keys_api_v1_signing_keys_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.SigningKeyResource) => string | number } = {}) => this.iterate<Schemas.SigningKeyResource>(`/signing-keys`, args.query, args.identity),
  };
  readonly stepUp = {
    create: (...args: Parameters<ManagementClient["operations"]["request_step_up_api_v1_step_up_post"]>) => this.operations.request_step_up_api_v1_step_up_post(...args),
  };
  readonly support = {
    delete: (...args: Parameters<ManagementClient["operations"]["remove_account_api_v1_support_delete"]>) => this.operations.remove_account_api_v1_support_delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["read_account_api_v1_support_get"]>) => this.operations.read_account_api_v1_support_get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_account_api_v1_support_patch"]>) => this.operations.patch_account_api_v1_support_patch(...args),
    verification: {
      create: (...args: Parameters<ManagementClient["operations"]["verification_account_api_v1_support_verification_post"]>) => this.operations.verification_account_api_v1_support_verification_post(...args),
    },
  };
  readonly users = {
    list: (...args: Parameters<ManagementClient["operations"]["list_users_api_v1_users_get"]>) => this.operations.list_users_api_v1_users_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_users_api_v1_users_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.UserResource) => string | number } = {}) => this.iterate<Schemas.UserResource>(`/users`, args.query, args.identity),
    create: (...args: Parameters<ManagementClient["operations"]["create_user_api_v1_users_post"]>) => this.operations.create_user_api_v1_users_post(...args),
    delete: (...args: Parameters<ManagementClient["operations"]["delete_user_api_v1_users__user_id__delete"]>) => this.operations.delete_user_api_v1_users__user_id__delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["get_user_api_v1_users__user_id__get"]>) => this.operations.get_user_api_v1_users__user_id__get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_user_api_v1_users__user_id__patch"]>) => this.operations.patch_user_api_v1_users__user_id__patch(...args),
    approve: {
      create: (...args: Parameters<ManagementClient["operations"]["approve_user_api_v1_users__user_id__approve_post"]>) => this.operations.approve_user_api_v1_users__user_id__approve_post(...args),
    },
    export: {
      get: (...args: Parameters<ManagementClient["operations"]["export_user_api_v1_users__user_id__export_get"]>) => this.operations.export_user_api_v1_users__user_id__export_get(...args),
    },
    memberships: {
      list: (...args: Parameters<ManagementClient["operations"]["list_user_memberships_api_v1_users__user_id__memberships_get"]>) => this.operations.list_user_memberships_api_v1_users__user_id__memberships_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_user_memberships_api_v1_users__user_id__memberships_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.MembershipResource) => string | number }) => this.iterate<Schemas.MembershipResource>(`/users/${encodeURIComponent(String(args.path["user_id"]))}/memberships`, args.query, args.identity),
    },
    mfa: {
      reset: {
        create: (...args: Parameters<ManagementClient["operations"]["reset_mfa_api_v1_users__user_id__mfa_reset_post"]>) => this.operations.reset_mfa_api_v1_users__user_id__mfa_reset_post(...args),
      },
    },
    processingBlock: {
      delete: (...args: Parameters<ManagementClient["operations"]["unblock_processing_api_v1_users__user_id__processing_block_delete"]>) => this.operations.unblock_processing_api_v1_users__user_id__processing_block_delete(...args),
      create: (...args: Parameters<ManagementClient["operations"]["block_processing_api_v1_users__user_id__processing_block_post"]>) => this.operations.block_processing_api_v1_users__user_id__processing_block_post(...args),
    },
    recovery: {
      create: (...args: Parameters<ManagementClient["operations"]["issue_recovery_api_v1_users__user_id__recovery_post"]>) => this.operations.issue_recovery_api_v1_users__user_id__recovery_post(...args),
    },
    reject: {
      create: (...args: Parameters<ManagementClient["operations"]["reject_user_api_v1_users__user_id__reject_post"]>) => this.operations.reject_user_api_v1_users__user_id__reject_post(...args),
    },
    sessions: {
      list: (...args: Parameters<ManagementClient["operations"]["list_sessions_api_v1_users__user_id__sessions_get"]>) => this.operations.list_sessions_api_v1_users__user_id__sessions_get(...args),
      iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_sessions_api_v1_users__user_id__sessions_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.SessionResource) => string | number }) => this.iterate<Schemas.SessionResource>(`/users/${encodeURIComponent(String(args.path["user_id"]))}/sessions`, args.query, args.identity),
      delete: (...args: Parameters<ManagementClient["operations"]["delete_session_api_v1_users__user_id__sessions__session_id__delete"]>) => this.operations.delete_session_api_v1_users__user_id__sessions__session_id__delete(...args),
      get: (...args: Parameters<ManagementClient["operations"]["get_session_api_v1_users__user_id__sessions__session_id__get"]>) => this.operations.get_session_api_v1_users__user_id__sessions__session_id__get(...args),
      revoke: {
        create: (...args: Parameters<ManagementClient["operations"]["revoke_user_sessions_api_v1_users__user_id__sessions_revoke_post"]>) => this.operations.revoke_user_sessions_api_v1_users__user_id__sessions_revoke_post(...args),
      },
    },
  };
  readonly webhookDeliveries = {
    list: (...args: Parameters<ManagementClient["operations"]["list_deliveries_api_v1_webhook_deliveries_get"]>) => this.operations.list_deliveries_api_v1_webhook_deliveries_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_deliveries_api_v1_webhook_deliveries_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.DeliveryResource) => string | number } = {}) => this.iterate<Schemas.DeliveryResource>(`/webhook-deliveries`, args.query, args.identity),
    get: (...args: Parameters<ManagementClient["operations"]["get_delivery_api_v1_webhook_deliveries__delivery_id__get"]>) => this.operations.get_delivery_api_v1_webhook_deliveries__delivery_id__get(...args),
    retry: {
      create: (...args: Parameters<ManagementClient["operations"]["retry_delivery_api_v1_webhook_deliveries__delivery_id__retry_post"]>) => this.operations.retry_delivery_api_v1_webhook_deliveries__delivery_id__retry_post(...args),
    },
  };
  readonly webhookEndpoints = {
    list: (...args: Parameters<ManagementClient["operations"]["list_endpoints_api_v1_webhook_endpoints_get"]>) => this.operations.list_endpoints_api_v1_webhook_endpoints_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["list_endpoints_api_v1_webhook_endpoints_get"]>[0]>, "body" | "options"> & { identity?: (item: Schemas.EndpointResource) => string | number } = {}) => this.iterate<Schemas.EndpointResource>(`/webhook-endpoints`, args.query, args.identity),
    create: (...args: Parameters<ManagementClient["operations"]["create_endpoint_api_v1_webhook_endpoints_post"]>) => this.operations.create_endpoint_api_v1_webhook_endpoints_post(...args),
    delete: (...args: Parameters<ManagementClient["operations"]["delete_endpoint_api_v1_webhook_endpoints__endpoint_id__delete"]>) => this.operations.delete_endpoint_api_v1_webhook_endpoints__endpoint_id__delete(...args),
    get: (...args: Parameters<ManagementClient["operations"]["get_endpoint_api_v1_webhook_endpoints__endpoint_id__get"]>) => this.operations.get_endpoint_api_v1_webhook_endpoints__endpoint_id__get(...args),
    update: (...args: Parameters<ManagementClient["operations"]["patch_endpoint_api_v1_webhook_endpoints__endpoint_id__patch"]>) => this.operations.patch_endpoint_api_v1_webhook_endpoints__endpoint_id__patch(...args),
    destinationChanges: {
      create: (...args: Parameters<ManagementClient["operations"]["change_destination_api_v1_webhook_endpoints__endpoint_id__destination_changes_post"]>) => this.operations.change_destination_api_v1_webhook_endpoints__endpoint_id__destination_changes_post(...args),
    },
    secret: {
      reveal: {
        create: (...args: Parameters<ManagementClient["operations"]["reveal_endpoint_api_v1_webhook_endpoints__endpoint_id__secret_reveal_post"]>) => this.operations.reveal_endpoint_api_v1_webhook_endpoints__endpoint_id__secret_reveal_post(...args),
      },
    },
    secretRotations: {
      create: (...args: Parameters<ManagementClient["operations"]["rotate_endpoint_api_v1_webhook_endpoints__endpoint_id__secret_rotations_post"]>) => this.operations.rotate_endpoint_api_v1_webhook_endpoints__endpoint_id__secret_rotations_post(...args),
    },
    test: {
      create: (...args: Parameters<ManagementClient["operations"]["test_endpoint_api_v1_webhook_endpoints__endpoint_id__test_post"]>) => this.operations.test_endpoint_api_v1_webhook_endpoints__endpoint_id__test_post(...args),
    },
  };
  readonly webhookEventTypes = {
    list: (...args: Parameters<ManagementClient["operations"]["event_types_api_v1_webhook_event_types_get"]>) => this.operations.event_types_api_v1_webhook_event_types_get(...args),
    iterate: (args: Omit<NonNullable<Parameters<ManagementClient["operations"]["event_types_api_v1_webhook_event_types_get"]>[0]>, "body" | "options"> & { identity: (item: Schemas.EventTypeResource) => string | number }) => this.iterate<Schemas.EventTypeResource>(`/webhook-event-types`, args.query, args.identity),
  };
}
export function createManagement(options: ManagementOptions): ManagementClient { return new ManagementClient(options); }
