// Fuseau d'affichage de référence : toutes les heures FoxO sont belges.
// Le rendu serveur (Vercel) tourne en UTC : ne jamais formater une heure
// sans forcer explicitement ce fuseau.
export const TZ_BRUSSELS = 'Europe/Brussels';

export function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('fr-BE', {
    hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS,
  });
}

export function fmtDateTime(iso: string | null, full = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return full
    ? d.toLocaleString('fr-BE', {
        weekday: 'long', day: 'numeric', month: 'long',
        hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS,
      })
    : d.toLocaleDateString('fr-BE', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: TZ_BRUSSELS,
      });
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', {
    weekday: 'short', day: 'numeric', month: 'long', timeZone: TZ_BRUSSELS,
  });
}

/** Date calendaire belge au format YYYY-MM-DD (pour champs date en DB). */
export function fmtDateISO(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ_BRUSSELS });
}

export function relTime(iso: string | null): string {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return '< 1h';
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}j`;
}

export function todayLong(): string {
  return new Date().toLocaleDateString('fr-BE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: TZ_BRUSSELS,
  });
}
