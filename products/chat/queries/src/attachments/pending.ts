import type { UploadResponse } from "@chat/contracts/attachment/upload";
import type { SessionId } from "@chat/contracts/chat/session";
import { useMutationState, type Mutation } from "@tanstack/react-query";

import { chatKeys } from "../keys.ts";

/**
 * The files a session is still uploading, in the order they were started.
 *
 * Guard: read back out of the mutation cache rather than written into the
 * attachment list as placeholder rows. A file the api has not stored yet has no
 * id, no `createdAt` and no sandbox path, so every shape the list could hold for
 * it is one the contract refuses — and the next refetch would drop it anyway.
 */
export function usePendingUploads(sessionId: SessionId): readonly File[] {
  const started = useMutationState<
    File | undefined,
    Mutation<UploadResponse, Error, File>
  >({
    filters: {
      mutationKey: chatKeys.attachmentUploads(sessionId),
      status: "pending",
    },
    select: (mutation) => mutation.state.variables,
  });

  return started.filter((file) => file !== undefined);
}
