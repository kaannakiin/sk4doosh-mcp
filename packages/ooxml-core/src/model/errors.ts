export type OoxmlErrorCode =
  | "not_a_package"
  | "legacy_binary_container"
  | "corrupt_package"
  | "unsupported_zip_feature"
  | "malformed_part_name"
  | "unsupported_part_encoding"
  | "part_too_large"
  | "package_too_large";

/**
 * Builds the consumer's error from a container-level failure. This package owns
 * the factual detail; the consumer owns the error class, the code vocabulary and
 * the recovery advice, which is where format nouns belong.
 */
export type OoxmlErrorFactory = (
  code: OoxmlErrorCode,
  message: string,
) => Error;
