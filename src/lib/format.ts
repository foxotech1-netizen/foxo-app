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

// ─── Heure murale belge → instant UTC ───────────────────────────────────────
//
// Les créneaux FoxO sont stockés en heure belge « murale » (date YYYY-MM-DD +
// heure HH:MM). Le serveur (Vercel) tourne en UTC : `new Date('2026-10-12T17:00:00')`
// y est interprété comme 17:00 UTC (= 19:00 à Bruxelles), et un offset codé en
// dur (+02:00) devient faux à l'heure d'hiver. Toute conversion d'un créneau en
// timestamp côté serveur DOIT passer par brusselsWallTimeToIso.

/** Décalage (en minutes) de Europe/Brussels par rapport à UTC à un instant donné. */
function brusselsOffsetMinutesAt(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_BRUSSELS,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Convertit une heure belge (date `YYYY-MM-DD` + heure `HH:MM` ou `HH:MM:SS`)
 * en timestamp ISO UTC exact, heure d'été / d'hiver résolue par Intl (aucune
 * règle codée en dur). Indépendant du fuseau de la machine qui exécute le code.
 *
 * @example brusselsWallTimeToIso('2026-10-12', '17:00') → '2026-10-12T15:00:00.000Z'
 * @example brusselsWallTimeToIso('2026-10-27', '09:00') → '2026-10-27T08:00:00.000Z'
 */
export function brusselsWallTimeToIso(dateIso: string, heure: string): string {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  const t = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(heure.trim());
  if (!d || !t) {
    throw new Error(`brusselsWallTimeToIso: date/heure invalide (« ${dateIso} », « ${heure} »)`);
  }
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), 0);
  // Deux passes : la première estime l'instant, la seconde corrige si l'offset
  // change entre l'estimation et l'instant réel (jours de changement d'heure).
  let utc = wall - brusselsOffsetMinutesAt(new Date(wall)) * 60_000;
  utc = wall - brusselsOffsetMinutesAt(new Date(utc)) * 60_000;
  return new Date(utc).toISOString();
}
