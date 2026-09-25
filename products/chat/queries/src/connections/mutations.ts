import type { Locale } from "@chat/contracts/common/locale";
import {
  integrationListResponseSchema,
  integrationSummarySchema,
  type CreateIntegrationRequest,
  type IntegrationListResponse,
  type IntegrationSummary,
} from "@chat/contracts/integration/registration";
import type {
  GrantScope,
  GrantTtl,
} from "@chat/contracts/integration/grant-scope";
import type {
  IntegrationApprovalSetting,
  ToolApprovalMode,
  ToolOverrideSetting,
} from "@chat/contracts/integration/tool-approval-mode";
import { useMutation } from "@tanstack/react-query";

import { authKeys } from "../auth/keys.ts";
import { useChatClient } from "../provider.tsx";
import { connectionKeys } from "./keys.ts";
import {
  INTEGRATION_PATHS,
  integrationPath,
  toolApprovalPath,
  toolOverridesPath,
} from "./path.ts";

/**
 * Guard: none of these patch the cache optimistically. Registering opens three
 * connections to a server this product has not met and can fail for five
 * distinct reasons, and disconnecting reaches a provider — so the row the api
 * ends up with is the only one worth showing.
 */
export function useAddIntegration(locale: Locale) {
  const client = useChatClient();

  return useMutation<IntegrationSummary, Error, CreateIntegrationRequest>({
    mutationFn: (body) =>
      client.request(INTEGRATION_PATHS.root, integrationSummarySchema, {
        method: "POST",
        locale,
        body,
      }),
    onSuccess: (_created, _input, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.integrations(),
      }),
  });
}

export function useRemoveIntegration(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, string>({
    mutationFn: (integrationId) =>
      client.requestNoContent(integrationPath(integrationId), {
        method: "DELETE",
        locale,
      }),
    onSettled: (_data, _error, _id, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({ queryKey: connectionKeys.all }),
  });
}

export function useDisconnect(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, string>({
    mutationFn: (integrationId) =>
      client.requestNoContent(integrationPath(integrationId, "/connection"), {
        method: "DELETE",
        locale,
      }),
    onSettled: (_data, _error, _id, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.integrations(),
      }),
  });
}

/**
 * Re-reads what a server offers, and notices when an open one has started
 * asking for a token.
 *
 * Guard: the api answers with the whole list rather than the one row, because a
 * server that closed moves its integration onto the authorization path and the
 * card has to change with it. The whole prefix is swept, not only the list: the
 * tool rows and the grants' availability were read from the old catalogue.
 */
export function useRefreshTools(locale: Locale) {
  const client = useChatClient();

  return useMutation<IntegrationListResponse, Error, string>({
    mutationFn: (integrationId) =>
      client.request(
        integrationPath(integrationId, "/tools"),
        integrationListResponseSchema,
        { method: "POST", locale },
      ),
    onSettled: (_data, _error, _id, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({ queryKey: connectionKeys.all }),
  });
}

export interface RememberToolInput {
  readonly exposedName: string;
  readonly scope: GrantScope;
  /** Required for a conversation-scoped grant, refused for a global one. */
  readonly sessionId?: string;
  readonly ttl: GrantTtl;
}

/**
 * Guard: the request carries no digest and no expiry. The api reads the
 * definition it is remembering out of its own records and computes the lapse
 * from the duration the reader picked — a page that sent either would let it
 * record consent on terms the reader never set.
 */
export function useRememberTool(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, RememberToolInput>({
    mutationFn: ({ exposedName, scope, sessionId, ttl }) =>
      client.requestNoContent(toolApprovalPath(exposedName), {
        method: "PUT",
        locale,
        body: scope === "session" ? { scope, sessionId, ttl } : { scope, ttl },
      }),
    onSettled: (_data, _error, _input, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.approvalsAll(),
      }),
  });
}

export function useForgetTool(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, string>({
    mutationFn: (exposedName) =>
      client.requestNoContent(toolApprovalPath(exposedName), {
        method: "DELETE",
        locale,
      }),
    onSettled: (_data, _error, _name, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.approvalsAll(),
      }),
  });
}

/**
 * Guard: invalidates the identity query rather than the connections one. The
 * duration is a property of the reader, not of any one server, and it rides back
 * on `/auth/me`.
 */
export function useSetGrantTtl(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, GrantTtl>({
    mutationFn: (ttl) =>
      client.requestNoContent(`${INTEGRATION_PATHS.approvals}/ttl`, {
        method: "PATCH",
        locale,
        body: { ttl },
      }),
    onSettled: (_data, _error, _ttl, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({ queryKey: authKeys.currentUser() }),
  });
}

/**
 * Guard: invalidates the identity query for the same reason the duration does:
 * the reader's own mode rides on `/auth/me`.
 */
export function useSetToolApprovalMode(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, ToolApprovalMode>({
    mutationFn: (mode) =>
      client.requestNoContent(`${INTEGRATION_PATHS.approvals}/mode`, {
        method: "PATCH",
        locale,
        body: { mode },
      }),
    onSettled: (_data, _error, _mode, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({ queryKey: authKeys.currentUser() }),
  });
}

export interface SetIntegrationApprovalModeInput {
  readonly integrationId: string;
  readonly mode: IntegrationApprovalSetting;
}

export function useSetIntegrationApprovalMode(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, SetIntegrationApprovalModeInput>({
    mutationFn: ({ integrationId, mode }) =>
      client.requestNoContent(
        integrationPath(integrationId, "/approval-mode"),
        {
          method: "PATCH",
          locale,
          body: { mode },
        },
      ),
    onSettled: (_data, _error, _input, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.integrations(),
      }),
  });
}

export interface SetToolOverrideInput {
  readonly exposedName: string;
  readonly mode: ToolOverrideSetting;
}

export function useSetToolOverride(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, SetToolOverrideInput>({
    mutationFn: ({ exposedName, mode }) =>
      client.requestNoContent(`${toolApprovalPath(exposedName)}/override`, {
        method: "PUT",
        locale,
        body: { mode },
      }),
    onSettled: (_data, _error, _input, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.approvalsAll(),
      }),
  });
}

export interface SetToolOverridesInput {
  readonly integrationId: string;
  /** Remote tool names, as the integration's tool list carries them. */
  readonly names: readonly string[];
  readonly mode: ToolOverrideSetting;
}

export function useSetToolOverrides(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, SetToolOverridesInput>({
    mutationFn: ({ integrationId, names, mode }) =>
      client.requestNoContent(toolOverridesPath(integrationId), {
        method: "PUT",
        locale,
        body: { mode, names },
      }),
    onSettled: (_data, _error, _input, _context, { client: queryClient }) =>
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.approvalsAll(),
      }),
  });
}
