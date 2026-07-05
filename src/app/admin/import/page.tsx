import { ImportClient } from './ImportClient';

// Import « encodage à froid » — reprise en masse d'interventions historiques
// depuis un fichier Excel. La création passe par la même logique métier que
// le bouton « Créer une intervention » (createInterventionCold : silencieux,
// ni Drive, ni agenda, ni notification). L'auth admin est déjà garantie par
// le layout /admin (redirect + isAdminUser).

export default function ImportEncodageFroidPage() {
  return (
    <>
      <div className="mb-6 pb-3.5 border-b border-[var(--color-sand-border)]">
        <h1 className="fxs-page-title mb-1">Import interventions</h1>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-mid)] tracking-wide">
          <span className="w-1 h-1 rounded-full bg-[var(--color-navy)]"></span>
          Encodage à froid — reprise de l&apos;historique depuis un fichier Excel (.xlsx)
        </div>
      </div>

      <div className="bg-navy-pale border border-navy-light rounded-xl px-4 py-3 mb-5 text-[12px] text-ink space-y-1 max-w-[980px]">
        <p>
          <strong>Mode d&apos;emploi</strong> — dépose le fichier Excel (en-têtes exacts en ligne 1),
          lance la <strong>validation à blanc</strong> (obligatoire, aucune écriture), corrige les rejets
          dans le fichier si besoin, puis importe.
        </p>
        <p>
          L&apos;import est <strong>relançable sans doublon</strong> (réf. FoxO déjà en base ignorée ;
          à défaut de réf., détection jour + adresse). Les <strong>ACP et syndics doivent déjà exister</strong> :
          une ligne dont l&apos;ACP ou le syndic est introuvable est rejetée — l&apos;import ne crée jamais de
          fiche référentiel. Statuts « Annulée » non importés. Création silencieuse : ni Drive, ni agenda,
          ni notification.
        </p>
      </div>

      <ImportClient />
    </>
  );
}
