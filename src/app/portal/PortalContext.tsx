'use client';

import { createContext, useContext, useMemo } from 'react';
import { type OrgType, type PortalVocab, vocabFor } from '@/lib/portal/vocab';
import { type Lang, type PortalStringKey, tFor } from '@/lib/portal/i18n';

type PortalContextValue = {
  orgType: OrgType;
  orgNom: string;
  orgEmail: string;
  lang: Lang;
  vocab: PortalVocab;
};

const Ctx = createContext<PortalContextValue | null>(null);

export function PortalProvider({
  orgType,
  orgNom,
  orgEmail,
  lang,
  children,
}: {
  orgType: OrgType;
  orgNom: string;
  orgEmail: string;
  lang: Lang;
  children: React.ReactNode;
}) {
  const value = useMemo<PortalContextValue>(
    () => ({ orgType, orgNom, orgEmail, lang, vocab: vocabFor(orgType, lang) }),
    [orgType, orgNom, orgEmail, lang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function usePortal(): PortalContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('Composant utilisé hors PortalProvider');
  return v;
}

export function useOrgType(): OrgType {
  return usePortal().orgType;
}

export function useVocab(): PortalVocab {
  return usePortal().vocab;
}

export function useLang(): Lang {
  return usePortal().lang;
}

// Hook de traduction des chaines generales : const t = useT(); t('logout').
export function useT(): (key: PortalStringKey) => string {
  return tFor(usePortal().lang);
}

export function usePortalContext(): PortalContextValue {
  return usePortal();
}
