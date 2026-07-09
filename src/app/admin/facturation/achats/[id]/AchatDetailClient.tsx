'use client';

// Détail / édition d'une facture d'achat. Les champs dont la confiance IA
// est < 0.8 sont surlignés (fond ambre + score) pour guider la relecture.
// Actions par statut : a_valider → Valider / Rejeter ; a_payer → Marquer payée.

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ExternalLink, Check, XCircle, CreditCard, UserPlus, Trash2, Calculator, Plus, QrCode, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { FactureAchat, FactureAchatLigne, Fournisseur } from '@/lib/types/database';
import {
  saveFactureAchat,
  validerFactureAchat,
  rejeterFactureAchat,
  marquerAchatPayee,
  creerFournisseurDepuisAchat,
  verifierIbanFournisseur,
  deleteFactureAchat,
} from '../actions';
import { STATUT_ACHAT_INFO, ConfianceDot, DoublonBadge } from '../AchatsListClient';
import { isIbanValid, normalizeIban, formatIban } from '@/lib/facturation/iban';

interface DossierResult { id: string; ref: string | null; adresse: string | null }

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDateFr(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function AchatDetailClient({
  achat,
  fournisseurs,
  categoriesSuggestions,
  doublonOriginal,
  interventionRef,
  fournisseurLieIban,
  qrDataUrl,
}: {
  achat: FactureAchat;
  fournisseurs: Fournisseur[];
  categoriesSuggestions: string[];
  doublonOriginal: { id: string; numero_piece: string | null; fournisseur_nom: string | null } | null;
  interventionRef: string | null;
  /** IBAN enregistré sur la fiche fournisseur liée (contrôle anti-fraude). */
  fournisseurLieIban: string | null;
  /** QR EPC de paiement pré-généré côté serveur (null si non générable). */
  qrDataUrl: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const [fournisseurId, setFournisseurId] = useState<string | null>(achat.fournisseur_id);
  const [fournisseurNom, setFournisseurNom] = useState(achat.fournisseur_nom ?? '');
  const [numeroPiece, setNumeroPiece] = useState(achat.numero_piece ?? '');
  const [dateFacture, setDateFacture] = useState(achat.date_facture ?? '');
  const [dateEcheance, setDateEcheance] = useState(achat.date_echeance ?? '');
  const [montantHt, setMontantHt] = useState<string>(achat.montant_ht != null ? String(achat.montant_ht) : '');
  const [montantTva, setMontantTva] = useState<string>(achat.montant_tva != null ? String(achat.montant_tva) : '');
  const [montantTtc, setMontantTtc] = useState<string>(achat.montant_ttc != null ? String(achat.montant_ttc) : '');
  const [tauxTva, setTauxTva] = useState<string>(achat.taux_tva != null ? String(achat.taux_tva) : '');
  const [categorie, setCategorie] = useState(achat.categorie_comptable ?? '');
  const [deductibilite, setDeductibilite] = useState<string>(String(achat.taux_deductibilite ?? 100));
  const [moyenPaiement, setMoyenPaiement] = useState(achat.moyen_paiement ?? '');
  // IBAN/communication de paiement — pré-remplis depuis la fiche fournisseur
  // si la facture n'en porte pas encore (task 3a).
  const [ibanPaiement, setIbanPaiement] = useState(achat.iban_paiement ?? fournisseurLieIban ?? '');
  const [communication, setCommunication] = useState(achat.communication ?? '');
  const [noteAdmin, setNoteAdmin] = useState(achat.note_admin ?? '');
  const [lignes, setLignesState] = useState<FactureAchatLigne[]>(achat.lignes ?? []);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Dossier lié (autocomplete /api/admin/interventions/search)
  const [interventionId, setInterventionId] = useState<string | null>(achat.intervention_id);
  const [dossierLabel, setDossierLabel] = useState<string | null>(interventionRef);
  const [dossierQuery, setDossierQuery] = useState('');
  const [dossierResults, setDossierResults] = useState<DossierResult[]>([]);

  // Paiement (statut a_payer)
  const [datePaiement, setDatePaiement] = useState(todayISO());
  const [moyenPaiementSaisi, setMoyenPaiementSaisi] = useState(achat.moyen_paiement ?? '');

  useEffect(() => {
    if (interventionId) return;
    const q = dossierQuery.trim();
    if (q.length < 2) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/interventions/search?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as { success: boolean; results?: DossierResult[] };
        if (json.success) setDossierResults(json.results ?? []);
      } catch { /* réseau : on laisse la liste précédente */ }
    }, 280);
    return () => clearTimeout(t);
  }, [dossierQuery, interventionId]);

  const showDossierResults = !interventionId && dossierQuery.trim().length >= 2 && dossierResults.length > 0;

  const conf = achat.ia_confiances ?? {};
  const lowConf = (field: string): number | null => {
    const v = conf[field];
    return typeof v === 'number' && v < 0.8 ? v : null;
  };

  const editable = achat.statut === 'a_valider' || achat.statut === 'a_payer';
  const statutInfo = STATUT_ACHAT_INFO[achat.statut];

  // ── Paiement fournisseur : dérivés basés sur les données ENREGISTRÉES ──
  // (l'IBAN affiché « en clair » et le QR reflètent le persisté, pas la saisie
  //  en cours — d'où le drapeau paiementDirty ci-dessous.)
  const ibanPersistNorm = achat.iban_paiement ? normalizeIban(achat.iban_paiement) : null;
  const ibanValide = ibanPersistNorm ? isIbanValid(ibanPersistNorm) : false;
  const ttcPaiement = achat.montant_ttc ?? 0;
  const ficheIbanNorm = fournisseurLieIban ? normalizeIban(fournisseurLieIban) : null;
  const ibanConforme = Boolean(ficheIbanNorm && ibanPersistNorm && ficheIbanNorm === ibanPersistNorm);
  const ibanDiffere = Boolean(ficheIbanNorm && ibanPersistNorm && ficheIbanNorm !== ibanPersistNorm);
  const hasFicheLiee = Boolean(achat.fournisseur_id);

  // Saisie non encore enregistrée vs valeurs persistées (IBAN / communication /
  // montant TTC — les 3 entrées du QR) → invite à ré-enregistrer.
  const ttcSaisi = (() => {
    const t = montantTtc.trim().replace(',', '.');
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  })();
  const paiementDirty =
    normalizeIban(ibanPaiement) !== (ibanPersistNorm ?? '')
    || communication.trim() !== (achat.communication ?? '').trim()
    || ttcSaisi !== (achat.montant_ttc ?? null);

  function buildInput() {
    const num = (s: string): number | null => {
      const t = s.trim().replace(',', '.');
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? n : null;
    };
    return {
      id: achat.id,
      lignes,
      fournisseur_id: fournisseurId,
      fournisseur_nom: fournisseurNom || null,
      numero_piece: numeroPiece || null,
      date_facture: dateFacture || null,
      date_echeance: dateEcheance || null,
      montant_ht: num(montantHt),
      montant_tva: num(montantTva),
      montant_ttc: num(montantTtc),
      taux_tva: num(tauxTva),
      categorie_comptable: categorie || null,
      taux_deductibilite: num(deductibilite) ?? 100,
      intervention_id: interventionId,
      moyen_paiement: moyenPaiement || null,
      note_admin: noteAdmin || null,
      iban_paiement: ibanPaiement.trim() || null,
      communication: communication.trim() || null,
    };
  }

  function handleSave(after?: () => Promise<{ ok: boolean; error?: string }>) {
    setFeedback(null);
    startTransition(async () => {
      const res = await saveFactureAchat(buildInput());
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      if (after) {
        const r2 = await after();
        if (!r2.ok) { setFeedback({ kind: 'err', msg: r2.error ?? 'Erreur.' }); return; }
      }
      setFeedback({ kind: 'ok', msg: after ? 'Action effectuée.' : 'Enregistré.' });
      router.refresh();
    });
  }

  // ── Lignes éditables ────────────────────────────────────────────────────
  function updateLigne(i: number, patch: Partial<FactureAchatLigne>) {
    setLignesState((arr) => arr.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, ...patch };
      // Montant recalculé qté × prix quand on touche l'un des deux —
      // mais il reste éditable à la main (patch.montant prioritaire).
      if (patch.montant === undefined && (patch.quantite !== undefined || patch.prix_unitaire !== undefined)) {
        const q = Number(next.quantite);
        const p = Number(next.prix_unitaire);
        if (Number.isFinite(q) && Number.isFinite(p)) {
          next.montant = Math.round(q * p * 100) / 100;
        }
      }
      return next;
    }));
  }
  function addLigne() {
    setLignesState((arr) => [...arr, { description: '', quantite: 1, prix_unitaire: null, montant: null }]);
  }
  function removeLigne(i: number) {
    setLignesState((arr) => arr.filter((_, idx) => idx !== i));
  }
  // Volontaire uniquement : les totaux extraits de la facture réelle restent
  // la source de vérité, pas de recalcul automatique.
  function recalculerTotaux() {
    const ht = Math.round(lignes.reduce((s, l) => s + (Number(l.montant) || 0), 0) * 100) / 100;
    const taux = Number(tauxTva.replace(',', '.'));
    setMontantHt(String(ht));
    if (Number.isFinite(taux) && taux >= 0) {
      const tva = Math.round(ht * taux) / 100;
      setMontantTva(String(tva));
      setMontantTtc(String(Math.round((ht + tva) * 100) / 100));
    }
  }

  function handleDelete() {
    setFeedback(null);
    startTransition(async () => {
      const res = await deleteFactureAchat(achat.id);
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); setShowDeleteConfirm(false); return; }
      router.push('/admin/facturation/achats');
      router.refresh();
    });
  }

  function handleCreerFournisseur() {
    setFeedback(null);
    startTransition(async () => {
      // Sauve d'abord (le nom éventuellement corrigé sert de base à la fiche).
      const s = await saveFactureAchat(buildInput());
      if (!s.ok) { setFeedback({ kind: 'err', msg: s.error }); return; }
      const res = await creerFournisseurDepuisAchat(achat.id);
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      setFournisseurId(res.data!.fournisseurId);
      setFeedback({ kind: 'ok', msg: 'Fiche fournisseur créée et liée.' });
      router.refresh();
    });
  }

  // « J'ai vérifié » : enregistre d'abord l'IBAN affiché (s'il a changé), puis
  // le recopie sur la fiche fournisseur + horodate la vérification anti-fraude.
  function handleVerifierIban() {
    setFeedback(null);
    startTransition(async () => {
      if (paiementDirty) {
        const s = await saveFactureAchat(buildInput());
        if (!s.ok) { setFeedback({ kind: 'err', msg: s.error }); return; }
      }
      const res = await verifierIbanFournisseur(achat.id);
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      setFeedback({ kind: 'ok', msg: 'IBAN enregistré sur la fiche fournisseur et marqué vérifié.' });
      router.refresh();
    });
  }

  // Champ avec surlignage confiance < 0.8 (fond ambre + score).
  function ConfField({
    label, field, children,
  }: { label: string; field: string; children: React.ReactNode }) {
    const low = lowConf(field);
    return (
      <div className={low != null ? 'bg-amber-light border border-[#E8C896] rounded-lg p-2 -m-0.5' : undefined}>
        <label className="text-xs font-semibold text-ink-mid block mb-1.5">
          {label}
          {low != null && (
            <span className="ml-1.5 text-[10px] font-mono font-bold text-[#8A5A1A]">
              IA {(low * 100).toFixed(0)}% — à vérifier
            </span>
          )}
        </label>
        {children}
      </div>
    );
  }

  const inputCls =
    'w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid disabled:bg-sand-mid disabled:text-ink-muted';

  return (
    <div className="space-y-5 max-w-[960px]">
      {/* Bandeau statut + doublon + justificatif */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-md border ${statutInfo.cls}`}>
          {statutInfo.label}
        </span>
        <ConfianceDot value={achat.ia_confiance_min} />
        {achat.doublon_de_id && doublonOriginal && (
          <span className="inline-flex items-center gap-1.5">
            <DoublonBadge />
            <Link
              href={`/admin/facturation/achats/${doublonOriginal.id}`}
              className="text-[11px] text-navy underline hover:no-underline"
            >
              Voir l&apos;original ({doublonOriginal.fournisseur_nom ?? '?'} — {doublonOriginal.numero_piece ?? 'sans n°'})
            </Link>
          </span>
        )}
        {achat.justificatif_url && (
          <a
            href={achat.justificatif_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-navy font-semibold underline hover:no-underline inline-flex items-center gap-1"
          >
            <ExternalLink size={12} aria-hidden /> Justificatif Drive
          </a>
        )}
      </div>

      {/* Fournisseur */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 space-y-3">
        <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest">Fournisseur</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-ink-mid block mb-1.5">Fiche fournisseur</label>
            <select
              value={fournisseurId ?? ''}
              onChange={(e) => {
                const id = e.target.value || null;
                setFournisseurId(id);
                const f = fournisseurs.find((x) => x.id === id);
                if (f) setFournisseurNom(f.nom);
              }}
              disabled={!editable}
              className={inputCls}
            >
              <option value="">— Aucune fiche liée —</option>
              {fournisseurs.map((f) => (
                <option key={f.id} value={f.id}>{f.nom}{f.tva ? ` (${f.tva})` : ''}</option>
              ))}
            </select>
            {!fournisseurId && editable && (
              <button
                type="button"
                onClick={handleCreerFournisseur}
                disabled={pending || !fournisseurNom.trim()}
                className="mt-2 text-[11px] font-bold text-navy bg-navy-pale border border-navy-light rounded-md px-2.5 py-1.5 hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1 dark:text-white"
                title="Crée la fiche fournisseur pré-remplie (nom + TVA extraits) et la lie."
              >
                <UserPlus size={12} aria-hidden /> Créer la fiche
              </button>
            )}
          </div>
          <ConfField label="Nom (dénormalisé)" field="fournisseur_nom">
            <input value={fournisseurNom} onChange={(e) => setFournisseurNom(e.target.value)} disabled={!editable} className={inputCls} />
          </ConfField>
        </div>
      </div>

      {/* Pièce */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 space-y-3">
        <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest">Pièce</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ConfField label="N° de pièce" field="numero_piece">
            <input value={numeroPiece} onChange={(e) => setNumeroPiece(e.target.value)} disabled={!editable} className={`${inputCls} font-mono`} />
          </ConfField>
          <ConfField label="Date facture" field="date_facture">
            <input type="date" value={dateFacture} onChange={(e) => setDateFacture(e.target.value)} disabled={!editable} className={inputCls} />
          </ConfField>
          <ConfField label="Date échéance" field="date_echeance">
            <input type="date" value={dateEcheance} onChange={(e) => setDateEcheance(e.target.value)} disabled={!editable} className={inputCls} />
          </ConfField>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ConfField label="Montant HT (€)" field="montant_ht">
            <input value={montantHt} onChange={(e) => setMontantHt(e.target.value)} disabled={!editable} inputMode="decimal" className={`${inputCls} font-mono`} />
          </ConfField>
          <ConfField label="TVA (€)" field="montant_tva">
            <input value={montantTva} onChange={(e) => setMontantTva(e.target.value)} disabled={!editable} inputMode="decimal" className={`${inputCls} font-mono`} />
          </ConfField>
          <ConfField label="Montant TTC (€)" field="montant_ttc">
            <input value={montantTtc} onChange={(e) => setMontantTtc(e.target.value)} disabled={!editable} inputMode="decimal" className={`${inputCls} font-mono`} />
          </ConfField>
          <ConfField label="Taux TVA (%)" field="taux_tva">
            <input value={tauxTva} onChange={(e) => setTauxTva(e.target.value)} disabled={!editable} inputMode="decimal" className={`${inputCls} font-mono`} />
          </ConfField>
        </div>
        <div className="border-t border-sand-border pt-2 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">
              Lignes
            </div>
            {editable && (
              <button
                type="button"
                onClick={recalculerTotaux}
                title="Remplace HT/TVA/TTC par la somme des lignes × taux — les totaux extraits de la facture réelle restent la référence, ce recalcul est volontaire."
                className="text-[10px] font-semibold text-ink-mid hover:text-navy inline-flex items-center gap-1"
              >
                <Calculator size={11} aria-hidden /> Recalculer les totaux depuis les lignes
              </button>
            )}
          </div>
          {lignes.length === 0 && (
            <p className="text-[11px] text-ink-muted italic">Aucune ligne.</p>
          )}
          {lignes.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_64px_84px_92px_auto] gap-1.5 items-center">
              <input
                value={l.description}
                onChange={(e) => updateLigne(i, { description: e.target.value })}
                disabled={!editable}
                placeholder="Description"
                className="px-2 py-1.5 border border-sand-border rounded-md text-[12px] bg-white outline-none focus:border-navy-mid disabled:bg-sand-mid disabled:text-ink-muted"
              />
              <input
                value={l.quantite ?? ''}
                onChange={(e) => updateLigne(i, { quantite: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })}
                disabled={!editable}
                inputMode="decimal"
                placeholder="Qté"
                title="Quantité"
                className="px-2 py-1.5 border border-sand-border rounded-md text-[12px] font-mono bg-white outline-none focus:border-navy-mid disabled:bg-sand-mid disabled:text-ink-muted"
              />
              <input
                value={l.prix_unitaire ?? ''}
                onChange={(e) => updateLigne(i, { prix_unitaire: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })}
                disabled={!editable}
                inputMode="decimal"
                placeholder="P.U."
                title="Prix unitaire"
                className="px-2 py-1.5 border border-sand-border rounded-md text-[12px] font-mono bg-white outline-none focus:border-navy-mid disabled:bg-sand-mid disabled:text-ink-muted"
              />
              <input
                value={l.montant ?? ''}
                onChange={(e) => updateLigne(i, { montant: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })}
                disabled={!editable}
                inputMode="decimal"
                placeholder="Montant"
                title="Montant de la ligne (recalculé qté × prix, éditable)"
                className="px-2 py-1.5 border border-sand-border rounded-md text-[12px] font-mono bg-white outline-none focus:border-navy-mid disabled:bg-sand-mid disabled:text-ink-muted"
              />
              {editable ? (
                <button
                  type="button"
                  onClick={() => removeLigne(i)}
                  title="Retirer la ligne"
                  className="text-terra hover:opacity-70 p-1"
                >
                  <XCircle size={14} aria-hidden />
                </button>
              ) : <span />}
            </div>
          ))}
          {editable && (
            <button
              type="button"
              onClick={addLigne}
              className="bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1 rounded-md text-[11px] font-semibold hover:bg-sand-hover inline-flex items-center gap-1"
            >
              <Plus size={12} aria-hidden /> Ligne
            </button>
          )}
        </div>
      </div>

      {/* Payer ce fournisseur : QR EPC + contrôle anti-fraude IBAN */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <QrCode size={15} className="text-navy" aria-hidden />
          <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest">Payer ce fournisseur</div>
        </div>

        {/* Saisie IBAN + communication (surlignage confiance IA si &lt; 0.8 :
            un IBAN invalide mod-97 est marqué confiance 0 → alerte visible). */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ConfField label="IBAN de paiement" field="iban">
            <input
              value={ibanPaiement}
              onChange={(e) => setIbanPaiement(e.target.value)}
              disabled={!editable}
              placeholder="BE.. (compte du fournisseur)"
              className={`${inputCls} font-mono`}
            />
          </ConfField>
          <ConfField label="Communication" field="communication">
            <input
              value={communication}
              onChange={(e) => setCommunication(e.target.value)}
              disabled={!editable}
              placeholder="+++.../...+++ ou libre"
              className={`${inputCls} font-mono`}
            />
          </ConfField>
        </div>

        {/* État du paiement (basé sur les données ENREGISTRÉES). */}
        {!ibanPersistNorm ? (
          <p className="text-[12px] text-ink-mid">
            Renseignez l&apos;IBAN pour générer le QR de paiement.
          </p>
        ) : !ibanValide ? (
          <div className="text-[12px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 font-semibold">
            IBAN invalide (contrôle mod-97) — corrigez-le pour générer le QR de paiement.
          </div>
        ) : ttcPaiement <= 0 ? (
          <div className="text-[12px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 font-semibold">
            Montant TTC nul ou négatif — renseignez un montant pour générer le QR.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Contrôle anti-fraude — AU-DESSUS du QR. */}
            {achat.iban_verifie_at ? (
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ok bg-ok-light border border-ok-mid rounded-md px-2.5 py-1">
                <ShieldCheck size={13} aria-hidden />
                IBAN vérifié le {fmtDateFr(achat.iban_verifie_at)} — conforme à la fiche fournisseur.
              </div>
            ) : ibanDiffere ? (
              <div className="bg-terra-light border border-terra-mid rounded-lg px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2 text-[12px] text-terra font-semibold">
                  <ShieldAlert size={16} aria-hidden className="flex-shrink-0 mt-0.5" />
                  <span>
                    ⚠️ L&apos;IBAN de cette facture diffère de celui enregistré pour ce fournisseur
                    (<span className="font-mono">{formatIban(ficheIbanNorm)}</span>). Fraude au virement
                    possible : vérifiez par téléphone auprès d&apos;un contact connu avant de payer.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleVerifierIban}
                  disabled={pending}
                  className="bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[40px] inline-flex items-center gap-1.5"
                >
                  <ShieldCheck size={14} aria-hidden /> J&apos;ai vérifié, mettre à jour l&apos;IBAN du fournisseur
                </button>
              </div>
            ) : !ficheIbanNorm ? (
              <div className="bg-amber-light border border-[#E8C896] rounded-lg px-3 py-2.5 space-y-2">
                <div className="flex items-start gap-2 text-[12px] text-[#8A5A1A] font-semibold">
                  <ShieldAlert size={16} aria-hidden className="flex-shrink-0 mt-0.5" />
                  <span>
                    Premier paiement vers ce fournisseur : vérifiez l&apos;IBAN auprès d&apos;un contact connu.
                  </span>
                </div>
                {hasFicheLiee ? (
                  <button
                    type="button"
                    onClick={handleVerifierIban}
                    disabled={pending}
                    className="bg-navy text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[40px] inline-flex items-center gap-1.5"
                  >
                    <ShieldCheck size={14} aria-hidden /> J&apos;ai vérifié, mettre à jour l&apos;IBAN du fournisseur
                  </button>
                ) : (
                  <p className="text-[11px] text-[#8A5A1A]">
                    Liez une fiche fournisseur (ci-dessus) pour enregistrer l&apos;IBAN vérifié.
                  </p>
                )}
              </div>
            ) : ibanConforme ? (
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ok bg-ok-light border border-ok-mid rounded-md px-2.5 py-1">
                <ShieldCheck size={13} aria-hidden />
                IBAN conforme à la fiche fournisseur
              </div>
            ) : null}

            {/* Bénéficiaire + IBAN + montant + communication EN CLAIR + QR. */}
            <div className="bg-white border border-sand-border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-center">
              <div className="space-y-2.5">
                <div>
                  <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">Bénéficiaire</div>
                  <div className="text-[15px] font-bold text-ink">{achat.fournisseur_nom ?? 'Fournisseur'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">IBAN</div>
                  <div className="text-[17px] font-mono font-bold text-navy tracking-wide dark:text-white break-all select-all">
                    {formatIban(ibanPersistNorm)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-8 gap-y-2.5">
                  <div>
                    <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">Montant</div>
                    <div className="text-[17px] font-mono font-bold text-ink tabular-nums">{fmtMoney(ttcPaiement)}</div>
                  </div>
                  {achat.communication && (
                    <div>
                      <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">Communication</div>
                      <div className="text-[13px] font-mono font-semibold text-ink break-all select-all">{achat.communication}</div>
                    </div>
                  )}
                </div>
              </div>
              {qrDataUrl ? (
                <div className="flex flex-col items-center gap-1 justify-self-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt="QR de paiement EPC (virement SEPA)"
                    width={168}
                    height={168}
                    className="rounded-lg border border-sand-border bg-white"
                  />
                  <span className="text-[10px] text-ink-muted">Scannez avec votre app bancaire</span>
                </div>
              ) : (
                <p className="text-[11px] text-ink-muted italic max-w-[160px] text-center justify-self-center">
                  QR indisponible — utilisez l&apos;IBAN ci-dessus.
                </p>
              )}
            </div>
            {paiementDirty && (
              <p className="text-[11px] text-ink-mid italic">
                Modifications non enregistrées — cliquez « Enregistrer » pour régénérer le QR.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Comptabilité + dossier */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 space-y-3">
        <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest">Comptabilité & dossier</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ConfField label="Catégorie comptable" field="categorie_suggeree">
            <input
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              disabled={!editable}
              list="categories-comptables"
              placeholder="Carburant, Matériel…"
              className={inputCls}
            />
            <datalist id="categories-comptables">
              {categoriesSuggestions.map((c) => <option key={c} value={c} />)}
            </datalist>
          </ConfField>
          <div>
            <label className="text-xs font-semibold text-ink-mid block mb-1.5">Déductibilité (%)</label>
            <input value={deductibilite} onChange={(e) => setDeductibilite(e.target.value)} disabled={!editable} inputMode="decimal" className={`${inputCls} font-mono`} />
          </div>
          <ConfField label="Moyen de paiement" field="moyen_paiement">
            <input value={moyenPaiement} onChange={(e) => setMoyenPaiement(e.target.value)} disabled={!editable} placeholder="virement, Bancontact…" className={inputCls} />
          </ConfField>
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Lier à un dossier</label>
          {interventionId ? (
            <div className="flex items-center gap-2 text-[12px]">
              <span className="font-mono font-bold text-navy bg-navy-pale border border-navy-light rounded-md px-2.5 py-1.5 dark:text-white">
                {dossierLabel ?? interventionId.slice(0, 8)}
              </span>
              {editable && (
                <button
                  type="button"
                  onClick={() => { setInterventionId(null); setDossierLabel(null); setDossierQuery(''); }}
                  className="text-[11px] text-ink-mid underline hover:text-navy"
                >
                  Délier
                </button>
              )}
            </div>
          ) : (
            <>
              <input
                value={dossierQuery}
                onChange={(e) => setDossierQuery(e.target.value)}
                disabled={!editable}
                placeholder="Référence ou adresse du dossier…"
                className={inputCls}
              />
              {showDossierResults && (
                <div className="mt-1.5 bg-white border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[180px] overflow-y-auto">
                  {dossierResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setInterventionId(r.id);
                        setDossierLabel(r.ref ?? r.adresse ?? r.id.slice(0, 8));
                        setDossierResults([]);
                      }}
                      className="block w-full text-left px-3 py-2 text-[12px] hover:bg-sand"
                    >
                      <span className="font-mono font-bold text-navy">{r.ref ?? '—'}</span>
                      <span className="text-ink-muted"> — {r.adresse ?? ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-mid block mb-1.5">Note interne</label>
          <textarea value={noteAdmin} onChange={(e) => setNoteAdmin(e.target.value)} disabled={!editable} rows={2} className={`${inputCls} resize-y`} />
        </div>
      </div>

      {feedback && (
        <div
          className={
            'text-[12px] rounded-md px-3 py-2 border font-semibold ' +
            (feedback.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-terra-light border-terra-mid text-terra')
          }
        >
          {feedback.msg}
        </div>
      )}

      {/* Actions par statut */}
      <div className="flex flex-wrap gap-2 items-center border-t border-sand-border pt-4">
        {editable && (
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={pending}
            className="bg-[#A17244] text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:bg-[#8A613B] disabled:opacity-50 min-h-[44px]"
          >
            {pending ? '…' : 'Enregistrer'}
          </button>
        )}
        {achat.statut === 'a_valider' && (
          <>
            <button
              type="button"
              onClick={() => handleSave(() => validerFactureAchat(achat.id))}
              disabled={pending}
              className="bg-navy text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
            >
              <Check size={14} aria-hidden /> Valider → à payer
            </button>
            <button
              type="button"
              onClick={() => {
                if (!confirm('Rejeter cette facture d\'achat ?')) return;
                handleSave(() => rejeterFactureAchat(achat.id));
              }}
              disabled={pending}
              className="bg-white text-terra border border-terra-mid px-4 py-2.5 rounded-lg text-[13px] font-bold hover:bg-terra-light disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
            >
              <XCircle size={14} aria-hidden /> Rejeter
            </button>
          </>
        )}
        {achat.statut === 'a_payer' && (
          <div className="flex flex-wrap items-end gap-2 bg-cream border border-sand-border rounded-xl p-3">
            <div>
              <label className="text-xs font-semibold text-ink-mid block mb-1.5">Date de paiement</label>
              <input type="date" value={datePaiement} onChange={(e) => setDatePaiement(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-mid block mb-1.5">Moyen</label>
              <input value={moyenPaiementSaisi} onChange={(e) => setMoyenPaiementSaisi(e.target.value)} placeholder="virement…" className={inputCls} />
            </div>
            <button
              type="button"
              onClick={() => handleSave(() => marquerAchatPayee(achat.id, datePaiement, moyenPaiementSaisi || null))}
              disabled={pending}
              className="bg-navy text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
            >
              <CreditCard size={14} aria-hidden /> Marquer payée
            </button>
          </div>
        )}
        {achat.statut === 'payee' && (
          <div className="text-[12px] text-ink-mid">
            Payée le <strong className="font-mono">{achat.date_paiement ?? '—'}</strong>
            {achat.moyen_paiement ? ` (${achat.moyen_paiement})` : ''}.
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={pending}
          className="ml-auto bg-white text-terra border border-terra-mid px-4 py-2.5 rounded-lg text-[13px] font-bold hover:bg-terra-light disabled:opacity-50 min-h-[44px] inline-flex items-center gap-1.5"
        >
          <Trash2 size={14} aria-hidden /> Supprimer
        </button>
      </div>

      {/* Modale de confirmation de suppression */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-cream rounded-2xl border border-sand-border p-5 w-full max-w-[420px] space-y-3">
            <h2 className="text-[14px] font-bold text-ink">
              Supprimer cette facture d&apos;achat ?
            </h2>
            <p className="text-[12px] text-ink-mid">
              Le justificatif reste archivé sur Drive.
            </p>
            {achat.statut === 'payee' && (
              <p className="text-[12px] font-semibold text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2">
                ⚠️ Cette facture est marquée PAYÉE — sa suppression la retire des coûts et du tableau de bord.
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                className="bg-terra text-white px-4 py-2.5 rounded-lg text-[13px] font-bold hover:opacity-90 disabled:opacity-50 min-h-[44px] flex-1"
              >
                {pending ? '…' : 'Supprimer'}
              </button>
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={pending}
                className="bg-white text-ink-mid border border-sand-border px-4 py-2.5 rounded-lg text-[13px] font-bold hover:bg-sand-hover disabled:opacity-50 min-h-[44px]"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
