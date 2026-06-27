'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LANGS } from '@/lib/portal/i18n';
import { useLang } from './PortalContext';
import { setPortalLang } from './actions';

// Bascule de langue FR | NL | EN. Ecrit la preference (cookie via server action)
// puis rafraichit pour un nouveau rendu SSR dans la langue choisie.
export function LangSwitcher() {
  const current = useLang();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(code: string) {
    if (code === current || pending) return;
    startTransition(async () => {
      await setPortalLang(code);
      router.refresh();
    });
  }

  return (
    <div role="group" aria-label="Langue" style={{ display: 'flex', gap: 4, opacity: pending ? 0.6 : 1 }}>
      {LANGS.map((l) => {
        const active = l.code === current;
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => choose(l.code)}
            aria-pressed={active}
            style={{
              flex: 1,
              padding: '5px 0',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.04em',
              borderRadius: 6,
              cursor: active ? 'default' : 'pointer',
              border: active ? '1px solid rgba(96,165,250,0.6)' : '1px solid rgba(255,255,255,0.10)',
              background: active ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.04)',
              color: active ? '#FFFFFF' : 'rgba(255,255,255,0.65)',
              fontFamily: 'inherit',
              transition: 'all .15s',
            }}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
