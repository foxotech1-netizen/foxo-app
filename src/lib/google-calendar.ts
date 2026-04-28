// Google Calendar — synchronisation avec creneaux_disponibles / creneaux_bloques.
//
// Branchement futur :
//   - Variable d'env : GOOGLE_SERVICE_ACCOUNT_JSON (clé compte de service)
//   - Calendar ID : à définir par technicien dans `utilisateurs` (colonne future
//     `google_calendar_id`) ou un calendrier d'équipe partagé.
//
// Tant que les credentials ne sont pas configurés, ces fonctions retournent
// `{ ok: false, error: 'Google Calendar non configuré' }`. Elles se branchent
// automatiquement quand process.env.GOOGLE_SERVICE_ACCOUNT_JSON est présent.

export type CalendarSyncResult =
  | { ok: true; created: number; updated: number; blocked: number }
  | { ok: false; error: string };

export type CalendarEventResult =
  | { ok: true; event_id: string }
  | { ok: false; error: string };

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

// TODO : importe les événements Google Calendar du tech sur la fenêtre
// [from, to], et pour chaque événement crée une entrée dans
// `creneaux_bloques` (motif = title de l'événement). Les créneaux libres
// existants qui chevauchent un événement Google deviennent statut='bloque'.
export async function syncCalendarToCreneaux(
  _technicienId: string,
  _from: Date,
  _to: Date,
): Promise<CalendarSyncResult> {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google Calendar non configuré (GOOGLE_SERVICE_ACCOUNT_JSON manquant).' };
  }
  // Implémentation future : googleapis.calendar.events.list → upsert creneaux_bloques.
  return { ok: true, created: 0, updated: 0, blocked: 0 };
}

// TODO : crée un événement Google quand un créneau est réservé (statut='reserve').
// Doit retourner l'event_id pour le stocker dans creneaux_disponibles.google_event_id.
export async function createCalendarEvent(_args: {
  technicienId: string;
  startIso: string;
  endIso: string;
  summary: string;
  description?: string;
  location?: string;
}): Promise<CalendarEventResult> {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google Calendar non configuré.' };
  }
  // Implémentation future : googleapis.calendar.events.insert.
  return { ok: false, error: 'Non implémenté.' };
}

// TODO : supprime un événement Google quand un créneau est libéré.
export async function deleteCalendarEvent(_eventId: string, _technicienId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!googleConfigured()) {
    return { ok: false, error: 'Google Calendar non configuré.' };
  }
  // Implémentation future : googleapis.calendar.events.delete.
  return { ok: false, error: 'Non implémenté.' };
}
