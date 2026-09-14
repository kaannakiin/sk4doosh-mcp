import { errorCodeOf, isChatClientError } from "@chat/queries/client";
import { useTranslation } from "react-i18next";

export interface AuthErrorText {
  readonly code: string;
  readonly title: string | undefined;
  readonly body: string;
}

/**
 * Renders an api rejection as the copy this app wants to show for it.
 *
 * Guard: an own key wins, the api's sentence is the fallback. The codes worth
 * overriding are the ones a reader can act on — where the screen offers a link
 * the server knows nothing about, or where one code covers several situations
 * with opposite recoveries. Everything else is inert, and the server's sentence
 * is already localized through `x-locale`, so translating it twice would just
 * give the two copies room to drift.
 */
export function useAuthError(): (error: unknown) => AuthErrorText | undefined {
  const { t } = useTranslation();

  return (error: unknown) => {
    if (error === null || error === undefined) {
      return undefined;
    }
    const code = errorCodeOf(error) ?? "unknown";
    const served = isChatClientError(error) ? error.payload.message : "";
    const title = t(`auth.errors.${code}.title`, { defaultValue: "" });

    return {
      code,
      title: title.length === 0 ? undefined : title,
      body: t(`auth.errors.${code}.body`, {
        defaultValue: served.length > 0 ? served : t("errors.network"),
      }),
    };
  };
}
