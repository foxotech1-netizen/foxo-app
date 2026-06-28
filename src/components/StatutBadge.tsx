import { STATUT_INFO, type StatutIntervention } from '@/lib/types/database';
import { type Lang } from '@/lib/portal/i18n';

// Libelles de statut multilingues. Le FR reste la source historique (= STATUT_INFO.label)
// ET le defaut : l'admin (qui n'envoie pas de prop lang) reste 100% en francais.
// Les couleurs viennent toujours de STATUT_INFO (independantes de la langue).
// NOTE: traductions NL/EN generees par Claude — A FAIRE RELIRE par un natif NL.
const STATUT_LABEL: Record<Lang, Record<StatutIntervention, string>> = {
  fr: { nouvelle: 'Nouvelle', attente: 'En attente', confirmee: 'Confirmée', realisee: 'Réalisée', rapport: 'Rapport dispo.', cloturee: 'Clôturée', en_suspens: 'En suspens' },
  nl: { nouvelle: 'Nieuw', attente: 'In afwachting', confirmee: 'Bevestigd', realisee: 'Uitgevoerd', rapport: 'Rapport besch.', cloturee: 'Afgesloten', en_suspens: 'Opgeschort' },
  en: { nouvelle: 'New', attente: 'Pending', confirmee: 'Confirmed', realisee: 'Completed', rapport: 'Report avail.', cloturee: 'Closed', en_suspens: 'On hold' },
};

export function StatutBadge({
  statut,
  big = false,
  lang = 'fr',
}: {
  statut: StatutIntervention;
  big?: boolean;
  lang?: Lang;
}) {
  const info = STATUT_INFO[statut];
  const label = STATUT_LABEL[lang]?.[statut] ?? STATUT_INFO[statut].label;
  return (
    <span
      className="inline-block rounded-full font-semibold whitespace-nowrap"
      style={{
        color: info.fg,
        background: info.bg,
        fontSize: big ? 12 : 11,
        padding: big ? '4px 12px' : '3px 9px',
      }}
    >
      {label}
    </span>
  );
}
