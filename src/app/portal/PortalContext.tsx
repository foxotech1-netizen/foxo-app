'use client';

import { createContext, useContext, useMemo } from 'react';
import { type OrgType, type PortalVocab, vocabFor } from '@/lib/portal/vocab';

type PortalContextValue = {
  orgType: OrgType;
  orgNom: string;
  orgEmail: string;
  vocab: PortalVocab;
};

const Ctx = createContext<PortalContextValue | null>(null);

export function PortalProvider({
  orgType,
  orgNom,
  orgEmail,
  children,
}: {
  orgType: OrgType;
  orgNom: string;
  orgEmail: string;
  children: React.ReactNode;
}) {
  const value = useMemo<PortalContextValue>(
    () => ({ orgType, orgNom, orgEmail, vocab: vocabFor(orgType) }),
    [orgType, orgNom, orgEmail],
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

export function usePortalContext(): PortalContextValue {
  return usePortal();
}
