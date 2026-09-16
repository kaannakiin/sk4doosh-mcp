import type { Locale } from "@chat/contracts/common/locale";
import {
  integrationListResponseSchema,
  integrationSummarySchema,
  type CreateIntegration,
  type IntegrationListResponse,
  type IntegrationSummary,
} from "@chat/contracts/integration/registration";
import { useMutation } from "@tanstack/react-query";

import { useChatClient } from "../provider.tsx";
import { connectionKeys } from "./keys.ts";
import { INTEGRATION_PATHS, integrationPath } from "./path.ts";

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
