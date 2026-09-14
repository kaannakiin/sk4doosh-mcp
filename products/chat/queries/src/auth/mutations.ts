import {
  authSessionResponseSchema,
  pendingChallengeSchema,
  type ChallengeConfirmation,
  type ChallengeResend,
  type EmailRegistration,
  type OAuthProfileCompletion,
  type PasswordLogin,
  type PendingChallenge,
  type PhoneLoginRequest,
  type PhoneRegistration,
  type PublicUser,
  type VerificationRequest,
} from "@chat/contracts/auth/auth";
import type { Locale } from "@chat/contracts/common/locale";
import { mutationOptions, useMutation } from "@tanstack/react-query";

import type { ChatClient } from "../client.ts";
import { chatKeys } from "../keys.ts";
import { useChatClient } from "../provider.tsx";
import { authKeys } from "./keys.ts";
import { AUTH_PATHS } from "./path.ts";

/**
 * Guard: the query client comes from the mutation's own context, never from
 * `useQueryClient`. It is by definition the client this mutation was registered
 * against — a second lookup can name a different one when a caller passes an
 * explicit client to `useMutation` — and taking it here is what keeps these
 * factories free of React, so they compose the way `sessionDetailOptions` does.
 */
function challengeOptions<TInput>(
  client: ChatClient,
  path: string,
  locale: Locale,
) {
  return mutationOptions<PendingChallenge, Error, TInput>({
    mutationFn: (body) =>
      client.request(path, pendingChallengeSchema, {
        method: "POST",
        locale,
        body,
      }),
  });
}

function sessionOptions<TInput>(
  client: ChatClient,
  path: string,
  locale: Locale,
) {
  return mutationOptions<PublicUser, Error, TInput>({
    mutationFn: async (body) => {
      const { user } = await client.request(path, authSessionResponseSchema, {
        method: "POST",
        locale,
        body,
      });

      return user;
    },
    /**
     * Guard: the chat cache is dropped, not merged. Nothing keys a conversation
     * to its owner — `chatKeys.session(id)` is the bare uuid — so a second
     * sign-in in the same tab would read the previous reader's conversations
     * straight out of the cache and show them to someone else.
     */
    onSuccess: (user, _input, _onMutateResult, { client: queryClient }) => {
      queryClient.removeQueries({ queryKey: chatKeys.all });
      queryClient.setQueryData(authKeys.currentUser(), user);
    },
  });
}

export function registerEmailOptions(client: ChatClient, locale: Locale) {
  return challengeOptions<EmailRegistration>(
    client,
    AUTH_PATHS.registerEmail,
    locale,
  );
}

export function registerPhoneOptions(client: ChatClient, locale: Locale) {
  return challengeOptions<PhoneRegistration>(
    client,
    AUTH_PATHS.registerPhone,
    locale,
  );
}

export function requestVerificationOptions(client: ChatClient, locale: Locale) {
  return challengeOptions<VerificationRequest>(
    client,
    AUTH_PATHS.verificationRequest,
    locale,
  );
}

/**
 * Guard: a new code is asked for by challenge id, never by re-posting the
 * contact. The phone-login route answers a decoy for any request inside its
 * sixty second window, so re-posting the number hands back a challenge id that
 * was never stored, and every code entered against it is rejected.
 */
export function resendChallengeOptions(client: ChatClient, locale: Locale) {
  return challengeOptions<ChallengeResend>(
    client,
    AUTH_PATHS.verificationResend,
    locale,
  );
}

export function requestPhoneLoginOptions(client: ChatClient, locale: Locale) {
  return challengeOptions<PhoneLoginRequest>(
    client,
    AUTH_PATHS.phoneLoginRequest,
    locale,
  );
}

export function loginPasswordOptions(client: ChatClient, locale: Locale) {
  return sessionOptions<PasswordLogin>(
    client,
    AUTH_PATHS.loginPassword,
    locale,
  );
}

export function confirmVerificationOptions(client: ChatClient, locale: Locale) {
  return sessionOptions<ChallengeConfirmation>(
    client,
    AUTH_PATHS.verificationConfirm,
    locale,
  );
}

export function confirmPhoneLoginOptions(client: ChatClient, locale: Locale) {
  return sessionOptions<ChallengeConfirmation>(
    client,
    AUTH_PATHS.phoneLoginConfirm,
    locale,
  );
}

export function completeOAuthProfileOptions(
  client: ChatClient,
  locale: Locale,
) {
  return sessionOptions<OAuthProfileCompletion>(
    client,
    AUTH_PATHS.oauthComplete,
    locale,
  );
}

/**
 * Guard: only the identity is cleared here, never `queryClient.clear()`. A clear
 * would drop the `null` this just wrote — sending the guard back to `/auth/me`
 * on its way to the sign-in page — and would reset every mounted observer, which
 * then refetches against a cookieless api and produces a burst of 401s. The chat
 * cache is dropped by the caller, after the navigation resolves.
 */
export function logoutOptions(client: ChatClient, locale: Locale) {
  return mutationOptions<void, Error, void>({
    mutationFn: () =>
      client.requestNoContent(AUTH_PATHS.logout, { method: "POST", locale }),
    onSuccess: (_data, _input, _onMutateResult, { client: queryClient }) => {
      queryClient.setQueryData(authKeys.currentUser(), null);
    },
  });
}

export function useRegisterEmail(locale: Locale) {
  return useMutation(registerEmailOptions(useChatClient(), locale));
}

export function useRegisterPhone(locale: Locale) {
  return useMutation(registerPhoneOptions(useChatClient(), locale));
}

export function useRequestVerification(locale: Locale) {
  return useMutation(requestVerificationOptions(useChatClient(), locale));
}

export function useResendChallenge(locale: Locale) {
  return useMutation(resendChallengeOptions(useChatClient(), locale));
}

export function useRequestPhoneLogin(locale: Locale) {
  return useMutation(requestPhoneLoginOptions(useChatClient(), locale));
}

export function useLoginPassword(locale: Locale) {
  return useMutation(loginPasswordOptions(useChatClient(), locale));
}

export function useConfirmVerification(locale: Locale) {
  return useMutation(confirmVerificationOptions(useChatClient(), locale));
}

export function useConfirmPhoneLogin(locale: Locale) {
  return useMutation(confirmPhoneLoginOptions(useChatClient(), locale));
}

export function useCompleteOAuthProfile(locale: Locale) {
  return useMutation(completeOAuthProfileOptions(useChatClient(), locale));
}

export function useLogout(locale: Locale) {
  return useMutation(logoutOptions(useChatClient(), locale));
}
