'use client';

import { useEffect, useState } from 'react';
import { themes, type ThemeKey } from '@/lib/themes';
import { setTheme as applyAndPersistLocal, useTheme } from './ThemeApplier';
import { saveUserTheme } from '@/app/admin/parametres/theme-actions';

// Picker visuel — 3 cards avec aperçu des couleurs (sidebar / main bg /
// accent / texte) + nom du thème. Au clic :
//   1. applique le thème localement (CSS vars + localStorage)
//   2. upsert dans Supabase user_preferences (best-effort, la persistance
//      locale prime — si Supabase fail, l'UX n'est pas bloquée).
export function ThemePicker() {
  const current = useTheme();
  const [saving, setSaving] = useState<ThemeKey | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 2500);
    return () => clearTimeout(t);
  }, [feedback]);

  async function pick(themeKey: ThemeKey) {
    if (themeKey === current) return;
    setSaving(themeKey);
    setFeedback(null);
    // Apply local immédiat — UX fluide même si Supabase est lent
    applyAndPersistLocal(themeKey);
    try {
      const res = await saveUserTheme(themeKey);
      if (res.ok) {
        setFeedback({ kind: 'ok', msg: 'Préférence enregistrée ✓' });
      } else {
        // Échec serveur : on garde le thème local mais on signale que
        // la persistance multi-device a échoué (table manquante, etc.).
        setFeedback({ kind: 'err', msg: `Persisté localement — ${res.error}` });
      }
    } catch (e) {
      setFeedback({
        kind: 'err',
        msg: e instanceof Error ? `Persisté localement — ${e.message}` : 'Persisté localement.',
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <section
      className="rounded-xl border p-5 space-y-3"
      style={{ background: 'var(--card-bg)', borderColor: 'var(--card-border)' }}
    >
      <div>
        <h2 className="text-[13px] font-extrabold text-ink">🎨 Apparence</h2>
        <p className="text-[11px] text-ink-muted mt-0.5">
          Thème de l&apos;interface — synchronisé entre tous tes appareils.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.keys(themes) as ThemeKey[]).map((k) => {
          const t = themes[k];
          const active = current === k;
          const isSaving = saving === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => pick(k)}
              disabled={isSaving}
              aria-pressed={active}
              className={
                'group relative flex flex-col rounded-lg border-2 overflow-hidden text-left transition-all ' +
                (active
                  ? 'border-navy ring-2 ring-navy/30 shadow-md'
                  : 'border-[var(--card-border)] hover:border-navy-mid hover:shadow-sm')
                + ' disabled:opacity-60 disabled:cursor-wait'
              }
            >
              {/* Aperçu visuel : sidebar étroite + main bg + dot accent */}
              <div className="flex h-20">
                <div className="w-1/4" style={{ background: t.sidebar }} />
                <div className="flex-1 flex items-center justify-center" style={{ background: t.mainBg }}>
                  <span
                    className="w-8 h-8 rounded-full"
                    style={{ background: t.accent, boxShadow: `0 0 0 3px ${t.cardBg}` }}
                  />
                </div>
              </div>

              {/* Pied : nom + état */}
              <div className="px-3 py-2 bg-[var(--main-bg)] border-t border-[var(--card-border)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-bold text-ink">{t.name}</span>
                  {active && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-navy bg-navy-pale rounded-full px-1.5 py-0.5">
                      Actif
                    </span>
                  )}
                  {isSaving && (
                    <span className="text-[10px] text-ink-muted">…</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div
          className={
            'text-[11px] rounded-md px-3 py-2 border font-semibold ' +
            (feedback.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-amber-light border-[#E8C896] text-[#8A5A1A]')
          }
        >
          {feedback.msg}
        </div>
      )}
    </section>
  );
}
