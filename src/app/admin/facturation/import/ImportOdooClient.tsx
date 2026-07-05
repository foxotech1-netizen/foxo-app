'use client';

// Carte d'import Odoo (une par type : ventes / achats). Flux :
// sélection du CSV → lecture FileReader → dry-run (aperçu obligatoire,
// aucune écriture) → confirmation « Importer N pièces » → commit → rapport.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, Upload, CheckCircle2 } from 'lucide-react';
import { importOdoo, type ImportRapport } from './actions';

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

const STATUT_LABEL: Record<string, string> = {
  payee: 'Payée',
  envoyee: 'Envoyée',
  a_payer: 'À payer',
};

export function ImportOdooClient({
  kind,
  titre,
}: {
  kind: 'ventes' | 'achats';
  titre: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rapport, setRapport] = useState<ImportRapport | null>(null);
  const [phase, setPhase] = useState<'idle' | 'dryrun' | 'commit' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setCsvText(null);
    setFileName(null);
    setRapport(null);
    setPhase('idle');
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  // Excel (.xlsx/.xls) → CSV en mémoire (séparateur ';', valeurs contenant ';'
  // échappées par SheetJS), pour rester compatible avec le parseur serveur
  // inchangé. CSV / texte → lecture texte directe. SheetJS est importé
  // dynamiquement : le classeur n'alourdit pas le bundle initial de la page.
  async function fileToCsv(file: File): Promise<string> {
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    if (ext === 'xlsx' || ext === 'xls') {
      const buf = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array' });
      const first = wb.SheetNames[0];
      if (!first) throw new Error('Classeur Excel vide (aucune feuille).');
      return XLSX.utils.sheet_to_csv(wb.Sheets[first], { FS: ';' });
    }
    return await file.text();
  }

  async function handleFile(file: File) {
    setError(null);
    setRapport(null);
    setFileName(file.name);
    setPhase('dryrun');
    try {
      const text = await fileToCsv(file);
      setCsvText(text);
      const res = await importOdoo(kind, text, false);
      if (!res.ok) {
        setError(res.error);
        setPhase('idle');
        return;
      }
      setRapport(res.data!);
      setPhase('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lecture du fichier impossible.');
      setPhase('idle');
    }
  }

  function handleCommit() {
    if (!csvText || !rapport || rapport.a_creer === 0) return;
    setError(null);
    setPhase('commit');
    void (async () => {
      const res = await importOdoo(kind, csvText, true);
      if (!res.ok) {
        setError(res.error);
        setPhase('idle');
        return;
      }
      setRapport(res.data!);
      setPhase('done');
      router.refresh();
    })();
  }

  const busy = phase === 'dryrun' || phase === 'commit';

  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4 space-y-3">
      <h2 className="fxs-section-title text-ink flex items-center gap-1.5">
        <FileUp size={15} aria-hidden /> {titre}
      </h2>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
        className="w-full text-[12px] file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-navy file:text-white file:text-[12px] file:font-bold file:cursor-pointer"
      />
      {fileName && (
        <div className="text-[11px] text-ink-mid">
          Fichier : <span className="font-mono">{fileName}</span>
          {' · '}
          <button type="button" onClick={reset} className="text-navy underline hover:no-underline">
            changer
          </button>
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-[12px] text-ink-mid font-semibold">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {phase === 'dryrun' ? 'Analyse à blanc du CSV…' : 'Import en cours…'}
        </div>
      )}

      {error && (
        <div className="text-[12px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 font-semibold">
          {error}
        </div>
      )}

      {rapport && (
        <div className="space-y-3">
          {/* Compteurs */}
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="px-2 py-1 rounded-md bg-navy-pale text-navy border border-navy-light">
              {rapport.lignes_lues} ligne(s) lue(s)
            </span>
            <span className="px-2 py-1 rounded-md bg-ok-light text-ok border border-ok-mid">
              {phase === 'done' ? `${rapport.inserees ?? 0} insérée(s)` : `${rapport.a_creer} à créer`}
            </span>
            {rapport.doublons > 0 && (
              <span className="px-2 py-1 rounded-md bg-sand-mid text-ink-mid border border-sand-border">
                {rapport.doublons} doublon(s) ignoré(s)
              </span>
            )}
            {rapport.ignorees.length > 0 && (
              <span className="px-2 py-1 rounded-md bg-amber-light text-[#8A5A1A] border border-[#E8C896]">
                {rapport.ignorees.length} ignorée(s)
              </span>
            )}
            {rapport.collisions.length > 0 && (
              <span className="px-2 py-1 rounded-md bg-terra-light text-terra border border-terra-mid">
                {rapport.collisions.length} collision(s) de numéro
              </span>
            )}
          </div>

          {/* Aperçu */}
          {rapport.apercu.length > 0 && (
            <div className="overflow-x-auto border border-sand-border rounded-lg">
              <table className="w-full text-left min-w-[480px]">
                <thead>
                  <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted bg-sand">
                    <th className="px-2.5 py-1.5 font-bold">Numéro</th>
                    <th className="px-2.5 py-1.5 font-bold">{kind === 'ventes' ? 'Client' : 'Fournisseur'}</th>
                    <th className="px-2.5 py-1.5 font-bold">Date</th>
                    <th className="px-2.5 py-1.5 font-bold text-right">TTC</th>
                    <th className="px-2.5 py-1.5 font-bold">Statut prévu</th>
                  </tr>
                </thead>
                <tbody>
                  {rapport.apercu.map((l) => (
                    <tr key={l.numero} className="border-b border-sand-mid bg-white">
                      <td className="px-2.5 py-1.5 text-[11px] font-mono font-bold text-navy whitespace-nowrap">
                        {l.numero}
                        {l.note && (
                          <span className="ml-1.5 text-[9px] font-bold uppercase text-terra">{l.note}</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-[11px]">{l.tiers}</td>
                      <td className="px-2.5 py-1.5 text-[11px] font-mono whitespace-nowrap">{l.date}</td>
                      <td className="px-2.5 py-1.5 text-[11px] font-mono text-right whitespace-nowrap">{fmtMoney(l.ttc)}</td>
                      <td className="px-2.5 py-1.5 text-[11px]">{STATUT_LABEL[l.statut] ?? l.statut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rapport.a_creer > rapport.apercu.length && (
                <div className="px-2.5 py-1.5 text-[10px] text-ink-muted bg-sand">
                  … et {rapport.a_creer - rapport.apercu.length} autre(s) pièce(s).
                </div>
              )}
            </div>
          )}

          {/* Ignorées */}
          {rapport.ignorees.length > 0 && (
            <details className="text-[11px] text-ink-mid">
              <summary className="cursor-pointer font-semibold">
                Lignes ignorées ({rapport.ignorees.length})
              </summary>
              <ul className="mt-1.5 space-y-0.5 max-h-[160px] overflow-y-auto">
                {rapport.ignorees.map((x, i) => (
                  <li key={i}>
                    <span className="font-mono">{x.numero}</span> — {x.raison}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Collisions */}
          {rapport.collisions.length > 0 && (
            <p className="text-[11px] text-terra">
              Numéros déjà pris par des pièces non-Odoo, importés sous préfixe ODOO- :{' '}
              <span className="font-mono">{rapport.collisions.join(', ')}</span>
            </p>
          )}

          {/* Erreurs commit */}
          {rapport.erreurs.length > 0 && (
            <div className="text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2">
              {rapport.erreurs.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {/* Action */}
          {phase === 'done' ? (
            <div className="flex items-center gap-2 text-[12px] font-bold text-ok">
              <CheckCircle2 size={15} aria-hidden />
              Import terminé — {rapport.inserees ?? 0} pièce(s) insérée(s).
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCommit}
              disabled={busy || rapport.a_creer === 0}
              className="bg-navy text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
            >
              <Upload size={14} aria-hidden />
              {phase === 'commit' ? 'Import…' : `Importer ${rapport.a_creer} pièce(s)`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
