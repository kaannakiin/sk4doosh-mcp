/**
 * The owner a request acts as.
 *
 * Guard: this is threaded through call signatures rather than kept in an
 * `AsyncLocalStorage` the way the locale is. A locale read from the wrong async
 * context renders a sentence in the wrong language; an owner read from the wrong
 * context returns somebody else's conversation. Making it an argument means a
 * query cannot be written without naming whose data it reads.
 */
export type OwnerId = string & { readonly __owner: unique symbol };

export function asOwnerId(raw: string): OwnerId {
  return raw as OwnerId;
}
