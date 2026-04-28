'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generateCreneaux, deleteCreneau, deleteCreneauxRange } from './actions';
import type { CreneauDisponible, Utilisateur } from '@/lib/types/database';

const JOURS = [
  { idx: 0, label: 'Lun' },
  { idx: 1, label: 'Mar' },
  { idx: 2, label: 'Mer' },
  { idx: 3, label: 'Jeu' },
  { idx: 4, label: 'Ven' },
  { idx: 5, label: 'Sam' },
  { idx: 6, label: 'Dim' },
];

const PLAGES_DEFAULT = [
  { debut: '09:00', fin: '10:30', label: '09:00 → 10:30' },
  { debut: '11:00', fin: '12:30', label: '11:00 → 12:30' },
  { debut: '13:30', fin: '15:00', label: '13:30 → 15:00' },
  { debut: '17:00', fin: '18:30', label: '17:00 → 18:30' },
];

type CreneauRow = Pick<CreneauDisponible, 'id' | 'date' | 'heure_debut' | 'heure_fin' | 'statut' | 'technicien_id'>;

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function plusDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export function CreneauxClient({
  techs,
  initialCreneaux,
  initialTechId,
}: {
  techs: Utilisateur[];
  initialCreneaux: CreneauRow[];
  initialTechId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Tech sélectionné
  const [techId, setTechId] = useState<string>(initialTechId ?? techs[0]?.id ?? '');

  // Période
  const [dateDebut, setDateDebut] = useState<string>(todayISO());
  const [dateFin, setDateFin] = useState<string>(plusDaysISO(todayISO(), 30));

  // Jours sélectionnés (par défaut Lun-Ven)
  const [jours, setJours] = useState<number[]>([0, 1, 2, 3, 4]);
  function toggleJour(j: number) {
    setJours((prev) => prev.includes(j) ? prev.filter((x) => x !== j) : [...prev, j].sort());
  }

  // Plages sélectionnées (par défaut toutes)
  const [plagesSelected, setPlagesSelected] = useState<boolean[]>(PLAGES_DEFAULT.map(() => true));
  function togglePlage(i: number) {
    setPlagesSelected((prev) => prev.map((v, idx) => idx === i ? !v : v));
  }

  // Filtrer les créneaux affichés selon le tech sélectionné
  const filteredCreneaux = useMemo(() => {
    if (!techId) return initialCreneaux;
    return initialCreneaux.filter((c) => c.technicien_id === techId);
  }, [initialCreneaux, techId]);

  // Group by date pour l'affichage
  const groupedByDate = useMemo(() => {
    const m = new Map<string, CreneauRow[]>();
    for (const c of filteredCreneaux) {
      if (!m.has(c.date)) m.set(c.date, []);
      m.get(c.date)!.push(c);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.heure_debut.localeCompare(b.heure_debut));
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredCreneaux]);

  function handleGenerate() {
    setFeedback(null);
    if (!techId) {
      setFeedback({ kind: 'err', msg: 'Sélectionne un technicien.' });
      return;
    }
    const plages = PLAGES_DEFAULT.filter((_, i) => plagesSelected[i]);
    if (!plages.length) {
      setFeedback({ kind: 'err', msg: 'Sélectionne au moins une plage horaire.' });
      return;
    }
    if (!jours.length) {
      setFeedback({ kind: 'err', msg: 'Sélectionne au moins un jour de la semaine.' });
      return;
    }

    startTransition(async () => {
      const res = await generateCreneaux({
        technicien_id: techId,
        date_debut: dateDebut,
        date_fin: dateFin,
        jours,
        plages: plages.map((p) => ({ debut: p.debut, fin: p.fin })),
      });
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
      } else {
        setFeedback({
          kind: 'ok',
          msg: `${res.data?.created ?? 0} créneau(x) créé(s)${res.data?.skipped ? `, ${res.data.skipped} déjà existant(s)` : ''}.`,
        });
        router.refresh();
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const res = await deleteCreneau(id);
      if (!res.ok) setFeedback({ kind: 'err', msg: res.error });
      else router.refresh();
    });
  }

  function handleDeleteRange() {
    if (!techId) return;
    if (!confirm(`Supprimer tous les créneaux libres entre ${dateDebut} et ${dateFin} pour ce technicien ?`)) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteCreneauxRange({ technicien_id: techId, date_debut: dateDebut, date_fin: dateFin });
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
      } else {
        setFeedback({ kind: 'ok', msg: `${res.data?.deleted ?? 0} créneau(x) supprimé(s).` });
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Sélecteur tech */}
      <section className="bg-cream border border-sand-border rounded-2xl p-4">
        <h3 className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-3">
          Technicien
        </h3>
        <div className="flex flex-wrap gap-2">
          {techs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTechId(t.id)}
              className={
                'px-4 py-2 rounded-lg text-[13px] font-bold border-2 ' +
                (techId === t.id
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-ink border-sand-border hover:border-navy-mid')
              }
            >
              {t.prenom} {t.nom}
            </button>
          ))}
        </div>
      </section>

      {/* Générateur */}
      <section className="bg-cream border border-sand-border rounded-2xl p-4">
        <h3 className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-3">
          Générer des créneaux
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-xs font-semibold text-ink-mid block mb-1.5">Date début</label>
            <input
              type="date"
              value={dateDebut}
              onChange={(e) => setDateDebut(e.target.value)}
              className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-mid block mb-1.5">Date fin</label>
            <input
              type="date"
              value={dateFin}
              onChange={(e) => setDateFin(e.target.value)}
              className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Jours de la semaine</label>
          <div className="flex flex-wrap gap-2">
            {JOURS.map((j) => (
              <label
                key={j.idx}
                className={
                  'px-3 py-1.5 border-2 rounded-lg cursor-pointer text-xs font-semibold ' +
                  (jours.includes(j.idx)
                    ? 'border-navy bg-navy-pale text-navy'
                    : 'border-sand-border bg-white text-ink-mid')
                }
              >
                <input
                  type="checkbox"
                  checked={jours.includes(j.idx)}
                  onChange={() => toggleJour(j.idx)}
                  className="sr-only"
                />
                {j.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Plages horaires</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PLAGES_DEFAULT.map((p, i) => (
              <label
                key={p.label}
                className={
                  'px-3 py-2.5 border-2 rounded-lg cursor-pointer flex items-center gap-2 text-[13px] font-semibold ' +
                  (plagesSelected[i]
                    ? 'border-navy bg-navy-pale text-navy'
                    : 'border-sand-border bg-white text-ink-mid')
                }
              >
                <input
                  type="checkbox"
                  checked={plagesSelected[i]}
                  onChange={() => togglePlage(i)}
                  className="accent-[#1B3A6B]"
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>

        {feedback && (
          <div
            className={
              'text-[12px] rounded-md px-3 py-2 mb-3 border font-semibold ' +
              (feedback.kind === 'ok'
                ? 'bg-ok-light border-ok-mid text-ok'
                : 'bg-terra-light border-terra-mid text-terra')
            }
          >
            {feedback.msg}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={pending || !techId}
            className="bg-navy text-white py-2.5 rounded-lg font-bold text-[13px] hover:opacity-90 disabled:opacity-50"
          >
            {pending ? '…' : '+ Générer les créneaux'}
          </button>
          <button
            type="button"
            onClick={handleDeleteRange}
            disabled={pending || !techId}
            className="bg-terra-light text-terra border border-terra-mid py-2.5 rounded-lg font-bold text-[13px] hover:opacity-90 disabled:opacity-50"
          >
            Tout supprimer (période)
          </button>
        </div>
      </section>

      {/* Liste */}
      <section className="bg-cream border border-sand-border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-bold text-ink-muted uppercase tracking-widest">
            Créneaux existants
          </h3>
          <span className="text-[11px] text-ink-muted">{filteredCreneaux.length} au total</span>
        </div>

        {groupedByDate.length === 0 ? (
          <p className="text-[13px] text-ink-muted py-4 text-center">
            Aucun créneau pour ce technicien. Génère-en avec le formulaire ci-dessus.
          </p>
        ) : (
          <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {groupedByDate.map(([date, items]) => (
              <div key={date} className="bg-white border border-sand-border rounded-lg p-3">
                <div className="text-[12px] font-bold text-navy mb-2">
                  {new Date(date + 'T12:00:00').toLocaleDateString('fr-BE', {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}
                </div>
                <div className="flex flex-wrap gap-2">
                  {items.map((c) => {
                    const colorBg = c.statut === 'libre' ? 'bg-ok-light text-ok'
                      : c.statut === 'reserve' ? 'bg-navy-light text-navy'
                      : 'bg-sand-mid text-ink-muted';
                    return (
                      <div
                        key={c.id}
                        className={'flex items-center gap-2 px-2 py-1 rounded-md text-[12px] font-semibold ' + colorBg}
                      >
                        <span>{c.heure_debut} → {c.heure_fin}</span>
                        {c.statut === 'libre' && (
                          <button
                            type="button"
                            onClick={() => handleDelete(c.id)}
                            disabled={pending}
                            className="text-ok hover:text-terra text-[14px] leading-none"
                            title="Supprimer ce créneau"
                          >
                            ×
                          </button>
                        )}
                        {c.statut === 'reserve' && <span className="text-[10px]">(réservé)</span>}
                        {c.statut === 'bloque' && <span className="text-[10px]">(bloqué)</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
