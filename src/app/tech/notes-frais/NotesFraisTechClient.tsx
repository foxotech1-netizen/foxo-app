'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Plus, Save, Send } from 'lucide-react';
import type { CategorieNoteFrais, NoteFrais, StatutNoteFrais } from '@/lib/types/database';
import { categorieComptable } from '@/lib/types/database';

// Catégories regroupées par classification comptable belge — l'ordre
// d'affichage met les frais professionnels en premier (les plus courants).
const CATEGORIES: { v: CategorieNoteFrais; l: string }[] = [
  // Frais professionnels (100% déductible)
  { v: 'carburant',      l: 'Carburant' },
  { v: 'materiel',       l: 'Matériel' },
  { v: 'outillage',      l: 'Outillage' },
  { v: 'fournitures',    l: 'Fournitures' },
  { v: 'telephonie',     l: 'Téléphonie' },
  { v: 'formation',      l: 'Formation' },
  { v: 'transport',      l: 'Transport' },
  { v: 'sous_traitance', l: 'Sous-traitance' },
  { v: 'autre_achat',    l: 'Autre achat' },
  // Frais de représentation (50% déductible)
  { v: 'restaurant',     l: 'Restaurant' },
  { v: 'cafe_client',    l: 'Café client' },
  { v: 'repas_travail',  l: 'Repas de travail' },
  { v: 'reception',      l: 'Réception' },
  // Legacy (rétro-compat)
  { v: 'restauration',   l: 'Restauration (legacy)' },
  { v: 'autre',          l: 'Autre (legacy)' },
];

const STATUT_BADGE: Record<StatutNoteFrais, { fg: string; bg: string; label: string }> = {
  brouillon:  { fg: '#6B6558', bg: '#EDEAE3', label: 'Brouillon'  },
  soumise:    { fg: '#1B3A6B', bg: '#D6E4F7', label: 'Soumise'    },
  approuvee:  { fg: '#1F6B45', bg: '#D4EDE2', label: 'Approuvée'  },
  rejetee:    { fg: '#C4622D', bg: '#F7EDE5', label: 'Rejetée'    },
  remboursee: { fg: '#7C3AED', bg: '#F5F3FF', label: 'Remboursée' },
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0;
  return v.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface FormState {
  titre: string;
  categorie: CategorieNoteFrais;
  date_depense: string;
  fournisseur: string;
  montant_ttc: string; // string pour gérer la saisie progressive
  description: string;
}

const EMPTY_FORM: FormState = {
  titre: '',
  categorie: 'carburant',
  date_depense: todayIso(),
  fournisseur: '',
  montant_ttc: '',
  description: '',
};

export function NotesFraisTechClient({
  initialData,
  techEmail: _techEmail,
}: {
  initialData: NoteFrais[];
  techEmail: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<NoteFrais[]>(initialData);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  function resetForm() {
    setForm(EMPTY_FORM);
    setPhotoUrl(null);
    setFeedback(null);
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const r = await fetch('/api/tech/notes-frais/upload', { method: 'POST', body: fd });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Erreur upload.' });
        return;
      }
      setPhotoUrl(data.url as string);
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setUploading(false);
    }
  }

  async function handleCreate() {
    setFeedback(null);
    if (!form.titre.trim()) {
      setFeedback({ kind: 'err', msg: 'Le titre est requis.' });
      return;
    }
    const ttc = Number(form.montant_ttc.replace(',', '.'));
    if (!Number.isFinite(ttc) || ttc <= 0) {
      setFeedback({ kind: 'err', msg: 'Le montant TTC doit être > 0.' });
      return;
    }
    // Calcul auto htva (taux fixé à 21 %, simplification — l'admin peut
    // ajuster ensuite). Arrondi à 2 décimales pour rester aligné avec
    // la précision DB.
    const taux_tva = 21;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const montant_ttc = round2(ttc);
    const montant_htva = round2(montant_ttc / 1.21);

    setSubmitting(true);
    try {
      const r = await fetch('/api/tech/notes-frais', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titre: form.titre.trim(),
          categorie: form.categorie,
          montant_htva,
          taux_tva,
          montant_ttc,
          fournisseur: form.fournisseur.trim() || undefined,
          date_depense: form.date_depense,
          description: form.description.trim() || undefined,
          photo_url: photoUrl ?? undefined,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Erreur création.' });
        return;
      }
      const created = data.data as NoteFrais;
      setNotes((prev) => [created, ...prev]);
      resetForm();
      setShowForm(false);
      setFeedback({ kind: 'ok', msg: 'Note enregistrée en brouillon' });
      router.refresh();
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitOne(id: string) {
    setSubmittingId(id);
    setFeedback(null);
    try {
      const r = await fetch(`/api/tech/notes-frais/${id}/submit`, { method: 'POST' });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Erreur soumission.' });
        return;
      }
      setNotes((prev) => prev.map((n) => n.id === id ? { ...n, statut: 'soumise' as StatutNoteFrais } : n));
      setFeedback({ kind: 'ok', msg: 'Note soumise pour validation' });
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setSubmittingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold text-ink dark:text-[#F0ECE4]">
            Mes notes de frais
          </h1>
          <p className="text-[11px] text-ink-muted mt-0.5 dark:text-[#C8C2B8]">
            {notes.length} note{notes.length > 1 ? 's' : ''} enregistrée{notes.length > 1 ? 's' : ''}
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => { resetForm(); setShowForm(true); }}
            className="bg-navy text-white px-3 py-2.5 rounded-lg text-[12px] font-bold hover:opacity-90 inline-flex items-center gap-1.5"
          >
            <Plus size={14} />Nouvelle
          </button>
        )}
      </header>

      {feedback && (
        <div className={
          'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
          (feedback.kind === 'ok'
            ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#14281E] dark:border-[#2A4F3A] dark:text-[#7AC9A0]'
            : 'bg-terra-light border-terra-mid text-terra')
        }>
          {feedback.msg}
        </div>
      )}

      {/* Formulaire création */}
      {showForm && (
        <section className="bg-cream border border-sand-border rounded-2xl p-4 space-y-3 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
          <div className="text-[11px] font-bold text-navy uppercase tracking-widest dark:text-[#A8C4F2]">
            Nouvelle note
          </div>

          <FormField label="Titre">
            <input
              type="text"
              value={form.titre}
              onChange={(e) => setForm((f) => ({ ...f, titre: e.target.value }))}
              placeholder="Ex : Plein gasoil chantier Etterbeek"
              className="w-full px-3 py-3 border border-sand-border rounded-lg text-[14px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#2C2A24] dark:text-[#F0ECE4]"
            />
          </FormField>

          <FormField label="Catégorie">
            <select
              value={form.categorie}
              onChange={(e) => setForm((f) => ({ ...f, categorie: e.target.value as CategorieNoteFrais }))}
              className="w-full px-3 py-3 border border-sand-border rounded-lg text-[14px] bg-white outline-none focus:border-navy-mid"
            >
              {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
            {/* Badge de déductibilité comptable belge — calculé en
                live depuis la catégorie sélectionnée. Le trigger SQL
                applique la même logique côté DB à l'insert. */}
            {(() => {
              const d = categorieComptable(form.categorie);
              const isFull = d.tauxDeductibilite >= 100;
              return (
                <div
                  className={
                    'mt-1.5 text-[11px] font-bold inline-block px-2 py-0.5 rounded-full border ' +
                    (isFull
                      ? 'bg-ok-light text-ok border-ok-mid'
                      : 'bg-amber-light text-[#8A5A1A] border-[#E8C896]')
                  }
                  title={d.comptable === 'representation'
                    ? 'Frais de représentation — TVA non récupérable'
                    : 'Frais professionnel — TVA récupérable'}
                >
                  {d.tauxDeductibilite}% déductible
                </div>
              );
            })()}
          </FormField>

          <FormField label="Date de la dépense">
            <input
              type="date"
              value={form.date_depense}
              onChange={(e) => setForm((f) => ({ ...f, date_depense: e.target.value }))}
              className="w-full px-3 py-3 border border-sand-border rounded-lg text-[14px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#2C2A24] dark:text-[#F0ECE4]"
            />
          </FormField>

          <FormField label="Fournisseur (optionnel)">
            <input
              type="text"
              value={form.fournisseur}
              onChange={(e) => setForm((f) => ({ ...f, fournisseur: e.target.value }))}
              placeholder="Ex : Q8, Brico, Hubo…"
              className="w-full px-3 py-3 border border-sand-border rounded-lg text-[14px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#2C2A24] dark:text-[#F0ECE4]"
            />
          </FormField>

          <FormField label="Montant TTC (€) — TVA 21 % calculée auto">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.montant_ttc}
              onChange={(e) => setForm((f) => ({ ...f, montant_ttc: e.target.value }))}
              placeholder="0,00"
              className="w-full px-3 py-3 border border-sand-border rounded-lg text-[14px] font-mono bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#2C2A24] dark:text-[#F0ECE4]"
            />
          </FormField>

          <FormField label="Description (optionnel)">
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Précision, lien intervention…"
              className="w-full px-3 py-3 border border-sand-border rounded-lg text-[14px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#2C2A24] dark:text-[#F0ECE4]"
            />
          </FormField>

          <FormField label="Photo du ticket">
            {photoUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={photoUrl}
                alt="ticket"
                className="max-h-48 rounded-lg border border-sand-border w-full object-contain bg-white dark:border-[#2C2A24]"
              />
            ) : (
              <label className="flex flex-col items-center justify-center w-full py-6 border-2 border-dashed border-sand-border rounded-lg bg-white text-center cursor-pointer hover:bg-sand-hover dark:bg-[#221E1A] dark:border-[#2C2A24]">
                <Camera size={24} className="text-ink-mid dark:text-[#C8C2B8]" />
                <span className="text-[12px] text-ink-mid mt-1 dark:text-[#C8C2B8]">
                  {uploading ? 'Upload en cours…' : 'Toucher pour ajouter une photo'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            )}
            {photoUrl && (
              <button
                type="button"
                onClick={() => setPhotoUrl(null)}
                className="text-[11px] text-terra hover:underline mt-1 font-bold"
              >
                Retirer la photo
              </button>
            )}
          </FormField>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setShowForm(false); resetForm(); }}
              disabled={submitting || uploading}
              className="flex-1 px-3 py-3 rounded-lg text-[13px] font-bold bg-sand-mid text-ink border border-sand-border disabled:opacity-50 dark:bg-[#221E1A] dark:border-[#2C2A24] dark:text-[#F0ECE4]"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting || uploading}
              className="flex-[2] px-3 py-3 rounded-lg text-[13px] font-bold bg-navy text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              {submitting ? '…' : <><Save size={14} />Enregistrer en brouillon</>}
            </button>
          </div>
        </section>
      )}

      {/* Liste des notes */}
      {notes.length === 0 && !showForm ? (
        <div className="bg-cream border border-sand-border rounded-2xl p-6 text-center text-[13px] text-ink-muted dark:bg-[#1C1A16] dark:border-[#2C2A24] dark:text-[#C8C2B8]">
          Aucune note pour l&apos;instant. Touche « Nouvelle » pour ajouter une dépense.
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => {
            const badge = STATUT_BADGE[n.statut];
            const isSubmitting = submittingId === n.id;
            return (
              <article
                key={n.id}
                className="bg-cream border border-sand-border rounded-2xl p-3.5 dark:bg-[#1C1A16] dark:border-[#2C2A24]"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono text-ink-muted dark:text-[#C8C2B8]">
                      {fmtDate(n.date_depense)}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sand-mid text-ink-mid dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]">
                      {CATEGORIES.find((c) => c.v === n.categorie)?.l ?? n.categorie}
                    </span>
                  </div>
                  <span
                    className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                    style={{ color: badge.fg, background: badge.bg }}
                  >
                    {badge.label}
                  </span>
                </div>

                <div className="font-bold text-[14px] text-ink dark:text-[#F0ECE4]">
                  {n.titre}
                </div>
                {n.fournisseur && (
                  <div className="text-[11px] text-ink-mid mt-0.5 dark:text-[#C8C2B8]">
                    {n.fournisseur}
                  </div>
                )}

                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-[18px] font-extrabold font-mono text-ink dark:text-[#F0ECE4]">
                    {fmtMoney(n.montant_ttc)}
                  </span>
                  {n.statut === 'brouillon' && (
                    <button
                      type="button"
                      onClick={() => handleSubmitOne(n.id)}
                      disabled={isSubmitting}
                      className="bg-navy text-white px-3 py-1.5 rounded-md text-[11px] font-bold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {isSubmitting ? '…' : <><Send size={12} />Soumettre</>}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Sous-composant utilitaire ───────────────────────────────────────────

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-bold text-ink-muted uppercase tracking-widest block mb-1 dark:text-[#C8C2B8]">
        {label}
      </label>
      {children}
    </div>
  );
}
