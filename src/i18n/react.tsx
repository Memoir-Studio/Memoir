import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppLocale } from "../domain/settings";
import { tc, t, type MessageKey, type MessageParams } from "./translate";

const LocaleContext = createContext<AppLocale>("zh");

export function I18nProvider({
  locale,
  children,
}: {
  locale: AppLocale;
  children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useI18n() {
  const locale = useLocale();
  return useMemo(
    () => ({
      locale,
      t: (key: MessageKey, params?: MessageParams) => t(locale, key, params),
      tc: (key: MessageKey, count: number, params?: MessageParams) =>
        tc(locale, key, count, params),
    }),
    [locale],
  );
}
