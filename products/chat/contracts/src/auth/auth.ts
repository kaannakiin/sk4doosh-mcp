import { z } from "zod";

import { grantTtlSchema } from "../integration/grant-scope.ts";
import { toolApprovalModeSchema } from "../integration/tool-approval-mode.ts";

export const WEB_SESSION_ISSUER = "sk-mcp-auth";
export const WEB_SESSION_AUDIENCE = "sk-mcp-web";
export const WEB_ACCESS_TTL_MS = 15 * 60 * 1000;
export const WEB_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const AUTH_CHALLENGE_RESEND_MS = 60 * 1000;
export const AUTH_CHALLENGE_MAX_ATTEMPTS = 5;

export const authProviderSchema = z.enum(["google", "github"]);
export type AuthProvider = z.infer<typeof authProviderSchema>;

export const oauthIntentSchema = z.enum(["login", "link"]);
export type OAuthIntent = z.infer<typeof oauthIntentSchema>;

const nameSchema = z.string().trim().min(1).max(100);
const emailSchema = z.string().trim().toLowerCase().pipe(z.email());
export const phoneE164Schema = z.e164();
export type PhoneE164 = z.infer<typeof phoneE164Schema>;
const passwordSchema = z.string().min(12).max(128);
const challengeIdSchema = z.uuid();
const otpSchema = z.string().regex(/^\d{6}$/u);

export const emailRegistrationSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type EmailRegistration = z.infer<typeof emailRegistrationSchema>;

export const phoneRegistrationSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  phoneE164: phoneE164Schema,
});
export type PhoneRegistration = z.infer<typeof phoneRegistrationSchema>;

export const challengeConfirmationSchema = z.object({
  challengeId: challengeIdSchema,
  code: otpSchema,
});
export type ChallengeConfirmation = z.infer<typeof challengeConfirmationSchema>;

export const challengeResendSchema = z.object({
  challengeId: challengeIdSchema,
});
export type ChallengeResend = z.infer<typeof challengeResendSchema>;

/**
 * Guard: exactly one contact, enforced here rather than by a union. Zod strips
 * unknown keys, so a union of two object branches would accept a body carrying
 * both and silently discard the second — the caller would ask to verify a phone
 * and get an email challenge back.
 */
export const verificationRequestSchema = z
  .object({
    email: emailSchema.optional(),
    phoneE164: phoneE164Schema.optional(),
  })
  .refine(
    (value) => (value.email === undefined) !== (value.phoneE164 === undefined),
    { message: "provide either an email or a phone number" },
  );
export type VerificationRequest = z.infer<typeof verificationRequestSchema>;

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type PasswordLogin = z.infer<typeof passwordLoginSchema>;

export const phoneLoginRequestSchema = z.object({ phoneE164: phoneE164Schema });
export type PhoneLoginRequest = z.infer<typeof phoneLoginRequestSchema>;

export const oauthProviderParamsSchema = z.object({
  provider: authProviderSchema,
});
export type OAuthProviderParams = z.infer<typeof oauthProviderParamsSchema>;

export const oauthStartQuerySchema = z.object({
  intent: oauthIntentSchema.default("login"),
});
export type OAuthStartQuery = z.infer<typeof oauthStartQuerySchema>;

export const oauthCallbackQuerySchema = z.looseObject({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  error_description: z.string().optional(),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;

export const oauthProfileCompletionSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
});
export type OAuthProfileCompletion = z.infer<
  typeof oauthProfileCompletionSchema
>;

export const authChannelSchema = z.enum(["email", "phone"]);
export type AuthChannel = z.infer<typeof authChannelSchema>;

/**
 * Guard: the purpose, not the channel, selects the endpoint that confirms a
 * challenge. Registering a phone and signing in with one both answer
 * `channel: "phone"` while confirming at different routes, so a client reading
 * only the channel would post a verification code to the login route and be told
 * its perfectly good code is invalid.
 */
export const challengePurposeSchema = z.enum(["verifyContact", "phoneLogin"]);
export type ChallengePurpose = z.infer<typeof challengePurposeSchema>;

export const pendingChallengeSchema = z.object({
  challengeId: challengeIdSchema,
  purpose: challengePurposeSchema,
  expiresAt: z.iso.datetime(),
  resendAt: z.iso.datetime(),
  channel: authChannelSchema,
  maskedTarget: z.string(),
});
export type PendingChallenge = z.infer<typeof pendingChallengeSchema>;

export const publicUserSchema = z.object({
  id: z.uuid(),
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema.nullable(),
  phoneE164: phoneE164Schema.nullable(),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  providers: z.array(authProviderSchema),
  toolApprovalMode: toolApprovalModeSchema,
  grantTtl: grantTtlSchema,
  createdAt: z.iso.datetime(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authSessionResponseSchema = z.object({ user: publicUserSchema });
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export type OAuthResolution =
  | { readonly kind: "session"; readonly user: PublicUser }
  | { readonly kind: "profile_required" }
  | { readonly kind: "link_required" };

export const oauthStateEnvelopeSchema = z.looseObject({
  kind: z.literal("oauth_state"),
  provider: authProviderSchema,
  intent: oauthIntentSchema,
  state: z.string(),
  verifier: z.string(),
  nonce: z.string(),
  userId: z.string().optional(),
  sessionPublicId: z.string().optional(),
});

export const oauthPendingProfileSchema = z.looseObject({
  kind: z.literal("oauth_profile"),
  provider: authProviderSchema,
  providerAccountId: z.string(),
  email: z.email().nullable(),
  emailVerified: z.boolean(),
  suggestedFirstName: z.string().optional(),
  suggestedLastName: z.string().optional(),
});

export const googleOAuthProfileSchema = z.object({
  sub: z.string().min(1),
  email: z.email().optional(),
  email_verified: z.boolean().optional().default(false),
  given_name: z.string().trim().min(1).optional(),
  family_name: z.string().trim().min(1).optional(),
});

export const githubOAuthProfileSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).nullable(),
  login: z.string().trim().min(1),
});

export const githubOAuthEmailsSchema = z.array(
  z.object({
    email: z.email(),
    primary: z.boolean(),
    verified: z.boolean(),
  }),
);
