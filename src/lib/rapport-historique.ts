// Rapport historique (dossiers importés « encodage à froid ») : la
// description d'une intervention peut contenir une ligne
// « Rapport historique (Drive) : https://… ». Helper partagé entre le
// portail partenaire (détail dossier) et l'admin (fiche client 360°) —
// extrait de DossierPortalClient.tsx (PR #154), comportement identique.
// Importable côté serveur comme côté client (aucune dépendance).

export const HISTORIC_REPORT_RE = /Rapport historique.*?(https?:\/\/\S+)/;

export function splitHistoricReport(description: string | null): { text: string | null; url: string | null } {
  if (!description) return { text: null, url: null };
  const m = description.match(HISTORIC_REPORT_RE);
  if (!m) return { text: description, url: null };
  const text = description
    .split('\n')
    .filter((line) => !HISTORIC_REPORT_RE.test(line))
    .join('\n')
    .trim();
  return { text: text || null, url: m[1] };
}
