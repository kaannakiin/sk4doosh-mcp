/**
 * The internal surrogate a row is keyed on, carried as a string.
 *
 * Guard: the tables key on `BigInt` and `JSON.stringify` throws on a JavaScript
 * `bigint`, so a surrogate that reached a response body would turn a successful
 * query into a 500. A string keeps it representable; the brand keeps it apart
 * from the public uuids, which are strings too and would otherwise be
 * interchangeable to the compiler — swapping them reads another account's rows.
 */
export type UserId = string & { readonly __userId: unique symbol };
