import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  // Arabic (Syria), forced to Latin digits (nu-latn) so ICU-formatted numbers
  // match the Latin digits date-fns' `ar` locale produces elsewhere in the UI.
  const locale = "ar-SY-u-nu-latn";

  return {
    locale,
    messages: (await import("../messages/ar.json")).default,
  };
});
