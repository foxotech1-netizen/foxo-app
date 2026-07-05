'use client';

// Import « encodage à froid » — client de la page /admin/import. Flux :
// sélection du .xlsx → lecture SheetJS (1er onglet, en-têtes EXACTS validés
// contre COLONNES_IMPORT) → aperçu → « Validation à blanc » (dry-run intégral,
// aucune écriture) → « Importer » (activé seulement après un dry-run terminé).
// Envoi par chunks de 20 lignes vers /api/admin/import/encodage-froid.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, Loader2, Upload, CheckCircle2, Download, FlaskConical } from 'lucide-react';
import { COLONNES_IMPORT, type LigneImport } from '@/lib/import/encodage-froid';

const CHUNK_SIZE = 20;

interface ResultatLigne {
  row: number;
  status: 'ok' | 'doublon' | 'rejet';
  ref?: string;
  raison?: string;
  details?: string;
}

const STATUS_BADGE: Record<ResultatLigne['status'], { label: string; cls: string }> = {
  ok:      { label: 'OK',      cls: 'bg-ok-light text-ok border-ok-mid' },
  doublon: { label: 'Doublon', cls: 'bg-sand-mid text-ink-mid border-sand-border' },
  rejet:   { label: 'Rejet',   cls: 'bg-terra-light text-terra border-terra-mid' },
};

export function ImportClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [lignes, setLignes] = useState<LigneImport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'idle' | 'parsing' | 'dryrun' | 'import' | 'done'>('idle');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<ResultatLigne[]>([]);
  // Un import réel n'est autorisé qu'après un dry-run TERMINÉ sur ce fichier.
  const [dryRunDone, setDryRunDone] = useState(false);

  const busy = phase === 'parsing' || phase === 'dryrun' || phase === 'import';
  const compteurs = {
    ok: results.filter((r) => r.status === 'ok').length,
    doublon: results.filter((r) => r.status === 'doublon').length,
    rejet: results.filter((r) => r.status === 'rejet').length,
  };

  function reset() {
    setFileName(null);
    setLignes([]);
    setError(null);
    setPhase('idle');
    setProgress(null);
    setResults([]);
    setDryRunDone(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleFile(file: File) {
    reset();
    setFileName(file.name);
    setPhase('parsing');
    try {
      const buf = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const first = wb.SheetNames[0];
      if (!first) throw new Error('Classeur Excel vide (aucune feuille).');
      const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[first], {
        header: 1,
        raw: false,
        defval: '',
        dateNF: 'yyyy-mm-dd',
      });
      if (grid.length < 2) throw new Error('Aucune ligne de données (en-têtes en ligne 1 + au moins 1 ligne).');

      // En-têtes EXACTS, dans l'ordre de COLONNES_IMPORT.
      const headers = (grid[0] ?? []).map((h) => String(h).trim());
      for (let i = 0; i < COLONNES_IMPORT.length; i += 1) {
        if (headers[i] !== COLONNES_IMPORT[i].header) {
          throw new Error(
            `En-tête inattendu en colonne ${i + 1} : attendu « ${COLONNES_IMPORT[i].header} », lu « ${headers[i] || '(vide)'} ».`,
          );
        }
      }

      const parsed: LigneImport[] = [];
      grid.slice(1).forEach((cells, idx) => {
        const vals = COLONNES_IMPORT.map((_, i) => String(cells[i] ?? '').trim());
        if (vals.every((v) => !v)) return; // ligne entièrement vide
        const rec: Record<string, string | number> = { row: idx + 2 };
        COLONNES_IMPORT.forEach((c, i) => { rec[c.field] = vals[i]; });
        parsed.push(rec as unknown as LigneImport);
      });
      if (parsed.length === 0) throw new Error('Aucune ligne de données non vide dans le fichier.');
      setLignes(parsed);
      setPhase('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lecture du fichier impossible.');
      setPhase('idle');
      setLignes([]);
    }
  }

  async function run(dryRun: boolean) {
    setError(null);
    setResults([]);
    setProgress({ done: 0, total: lignes.length });
    setPhase(dryRun ? 'dryrun' : 'import');
    const all: ResultatLigne[] = [];
    try {
      for (let i = 0; i < lignes.length; i += CHUNK_SIZE) {
        const chunk = lignes.slice(i, i + CHUNK_SIZE);
        const r = await fetch('/api/admin/import/encodage-froid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk, dryRun }),
        });
        const data = (await r.json()) as { ok: boolean; error?: string; results?: ResultatLigne[] };
        if (!data.ok || !data.results) throw new Error(data.error ?? `HTTP ${r.status}`);
        all.push(...data.results);
        setResults([...all]);
        setProgress({ done: Math.min(i + CHUNK_SIZE, lignes.length), total: lignes.length });
      }
      if (dryRun) {
        setDryRunDone(true);
        setPhase('idle');
      } else {
        setPhase('done');
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau pendant l\'envoi.');
      setPhase('idle');
      if (!dryRun) setDryRunDone(false); // re-valider avant de retenter
    }
  }

  function exportRejets() {
    const rejets = results.filter((r) => r.status === 'rejet');
    if (rejets.length === 0) return;
    const lines = [
      'ligne;ref;raison',
      ...rejets.map((r) => [r.row, r.ref ?? '', (r.raison ?? '').replace(/;/g, ',')].join(';')),
    ];
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rejets-import-encodage-froid.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4 space-y-3 max-w-[980px]">
      <h2 className="fxs-section-title text-ink flex items-center gap-1.5">
        <FileUp size={15} aria-hidden /> Fichier Excel (.xlsx)
      </h2>

      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
          {lignes.length > 0 && <> · <strong>{lignes.length}</strong> ligne(s) de données lue(s)</>}
          {' · '}
          <button type="button" onClick={reset} className="text-navy underline hover:no-underline">
            changer
          </button>
        </div>
      )}

      {busy && (
        <div className="flex items-center gap-2 text-[12px] text-ink-mid font-semibold">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          {phase === 'parsing' && 'Lecture du classeur…'}
          {phase === 'dryrun' && `Validation à blanc… ${progress ? `${progress.done}/${progress.total} lignes` : ''}`}
          {phase === 'import' && `Import en cours… ${progress ? `${progress.done}/${progress.total} lignes` : ''}`}
        </div>
      )}

      {error && (
        <div className="text-[12px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 font-semibold">
          {error}
        </div>
      )}

      {/* Aperçu : 5 premières lignes */}
      {lignes.length > 0 && phase !== 'done' && (
        <div className="overflow-x-auto border border-sand-border rounded-lg">
          <table className="w-full text-left min-w-[720px]">
            <thead>
              <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted bg-sand">
                <th className="px-2.5 py-1.5 font-bold">Ligne</th>
                <th className="px-2.5 py-1.5 font-bold">Réf. FoxO</th>
                <th className="px-2.5 py-1.5 font-bold">Date</th>
                <th className="px-2.5 py-1.5 font-bold">ACP / Résidence</th>
                <th className="px-2.5 py-1.5 font-bold">Syndic</th>
                <th className="px-2.5 py-1.5 font-bold">Type</th>
                <th className="px-2.5 py-1.5 font-bold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {lignes.slice(0, 5).map((l) => (
                <tr key={l.row} className="border-b border-sand-mid bg-white">
                  <td className="px-2.5 py-1.5 text-[11px] font-mono text-ink-muted">{l.row}</td>
                  <td className="px-2.5 py-1.5 text-[11px] font-mono font-bold text-navy whitespace-nowrap">{l.ref_foxo || '(auto)'}</td>
                  <td className="px-2.5 py-1.5 text-[11px] font-mono whitespace-nowrap">{l.date}{l.heure ? ` ${l.heure}` : ''}</td>
                  <td className="px-2.5 py-1.5 text-[11px]">{l.acp || '—'}</td>
                  <td className="px-2.5 py-1.5 text-[11px]">{l.syndic || '—'}</td>
                  <td className="px-2.5 py-1.5 text-[11px]">{l.type || '—'}</td>
                  <td className="px-2.5 py-1.5 text-[11px]">{l.statut || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {lignes.length > 5 && (
            <div className="px-2.5 py-1.5 text-[10px] text-ink-muted bg-sand">
              … et {lignes.length - 5} autre(s) ligne(s).
            </div>
          )}
        </div>
      )}

      {/* Compteurs + journal */}
      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="px-2 py-1 rounded-md bg-ok-light text-ok border border-ok-mid">
              {compteurs.ok} {phase === 'done' ? 'créée(s)' : 'OK'}
            </span>
            <span className="px-2 py-1 rounded-md bg-sand-mid text-ink-mid border border-sand-border">
              {compteurs.doublon} doublon(s) ignoré(s)
            </span>
            <span className="px-2 py-1 rounded-md bg-terra-light text-terra border border-terra-mid">
              {compteurs.rejet} rejetée(s)
            </span>
            {compteurs.rejet > 0 && (
              <button
                type="button"
                onClick={exportRejets}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-sand-border bg-white text-ink-mid hover:border-navy-mid"
              >
                <Download size={12} aria-hidden /> Export CSV des rejets
              </button>
            )}
          </div>

          <div className="border border-sand-border rounded-lg overflow-hidden">
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full text-left min-w-[640px]">
                <thead className="sticky top-0">
                  <tr className="border-b border-sand-border text-[10px] uppercase tracking-wider text-ink-muted bg-sand">
                    <th className="px-2.5 py-1.5 font-bold">Ligne</th>
                    <th className="px-2.5 py-1.5 font-bold">Réf.</th>
                    <th className="px-2.5 py-1.5 font-bold">Résultat</th>
                    <th className="px-2.5 py-1.5 font-bold">Raison / détails</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const badge = STATUS_BADGE[r.status];
                    return (
                      <tr key={`${r.row}-${r.status}`} className="border-b border-sand-mid bg-white">
                        <td className="px-2.5 py-1.5 text-[11px] font-mono text-ink-muted">{r.row}</td>
                        <td className="px-2.5 py-1.5 text-[11px] font-mono font-bold text-navy whitespace-nowrap">{r.ref ?? '—'}</td>
                        <td className="px-2.5 py-1.5">
                          <span className={`text-[10px] font-bold border rounded-full px-2 py-0.5 whitespace-nowrap ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5 text-[11px] text-ink-mid">{r.raison ?? r.details ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {phase === 'done' ? (
        <div className="flex items-center gap-2 text-[12px] font-bold text-ok">
          <CheckCircle2 size={15} aria-hidden />
          Import terminé — {compteurs.ok} intervention(s) créée(s), {compteurs.doublon} doublon(s), {compteurs.rejet} rejet(s).
        </div>
      ) : (
        lignes.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void run(true)}
              disabled={busy}
              className="bg-white border-2 border-navy text-navy px-4 py-2.5 rounded-lg text-[13px] font-bold hover:bg-navy-pale disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
            >
              <FlaskConical size={14} aria-hidden />
              Validation à blanc
            </button>
            <button
              type="button"
              onClick={() => void run(false)}
              disabled={busy || !dryRunDone}
              title={dryRunDone ? undefined : 'Lance d\'abord la validation à blanc'}
              className="bg-navy text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
            >
              <Upload size={14} aria-hidden />
              Importer {lignes.length} ligne(s)
            </button>
            {!dryRunDone && lignes.length > 0 && (
              <span className="text-[11px] text-ink-muted italic">
                La validation à blanc est obligatoire avant l&apos;import.
              </span>
            )}
          </div>
        )
      )}
    </section>
  );
}
