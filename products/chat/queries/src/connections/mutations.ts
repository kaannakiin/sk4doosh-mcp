import type { Locale } from "@chat/contracts/common/locale";
import {
  integrationListResponseSchema,
  integrationSummarySchema,
  type CreateIntegration,
  type IntegrationListResponse,
  type IntegrationSummary,
} from "@chat/contracts/integration/registration";
import type { ToolApprovalMode } from "@chat/contracts/integration/tool-approval-mode";
import { useMutation } from "@tanstack/react-query";

import { authKeys } from "../auth/keys.ts";
import { useChatClient } from "../provider.tsx";
import { connectionKeys } from "./keys.ts";
import {
  INTEGRATION_PATHS,
  integrationPath,
  toolApprovalPath,
} from "./path.ts";

/**
 * Guard: none of these patch the cache optimistically. Registering opens three
 * connections to a server this product has not met and can fail for five
 * distinct reasons, and disconnecting reaches a provider — so the row the api
 * ends up with is the only one worth showing.
 */
export function useAddIntegration(locale: Locale) {
  const client = useChatClient();

  return useMutation<IntegrationSummary, Error, CreateIntegration>({
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
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.integrations(),
      }),
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
 * card has to change with it.
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
      void queryClient.invalidateQueries({
        queryKey: connectionKeys.integrations(),
      }),
  });
}

/**
 * Guard: the request carries no digest. The api reads the definition it is
 * remembering out of its own tool row — a digest the page could choose would let
 * it record consent for a definition the server never published.
 */
export function useRememberTool(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, string>({
    mutationFn: (exposedName) =>
      client.requestNoContent(toolApprovalPath(exposedName), {
        method: "PUT",
        locale,
      }),
    onSettled: (_data, _error, _name, _context, { client: queryClient }) =>
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
 * mode rides on `/auth/me`, because it is a property of the reader and not of
 * any one server.
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
