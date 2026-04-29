'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  saveFacture,
  setFactureStatut,
  searchInterventionsForFacture,
  loadInterventionForFacture,
  searchClients,
  saveClient,
  type FactureInput,
} from './actions';
import { generateBBA } from '@/lib/facturation/bba';
import { computeFactureTotals } from '@/lib/facturation/FactureFoxoPdf';
import type {
  Article,
  Client,
  Facture,
  FactureLigne,
  FactureDetailsIntervention,
  StatutFacture,
  TypeClient,
} from '@/lib/types/database';

interface InterventionRef {
  id: string;
  ref: string | null;
  acp_nom: string | null;
  syndic_nom: string | null;
}

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

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function htvaToTtc(htva: number, tvaPct: number): number {
  return Math.round(htva * (1 + tvaPct / 100) * 100) / 100;
}

function ttcToHtva(ttc: number, tvaPct: number): number {
  return Math.round((ttc / (1 + tvaPct / 100)) * 100) / 100;
}

export function FactureEditor({
  initial,
  initialNumero,
  articles,
}: {
  initial: Facture | null;
  initialNumero: string;
  articles: Article[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Mode : liée à une intervention vs hors intervention
  const [linked, setLinked] = useState<boolean>(initial?.intervention_id != null);

  // Identification
  const [numero, setNumero] = useState<string>(initial?.numero ?? initialNumero);
  const [dateEmission, setDateEmission] = useState<string>(initial?.date_emission ?? todayISO());
  const [dateEcheance, setDateEcheance] = useState<string>(
    initial?.date_echeance ?? plusDaysISO(todayISO(), 15),
  );
  const [reference, setReference] = useState<string>(initial?.reference ?? '');
  const [conditionsPaiement, setConditionsPaiement] = useState<string>(initial?.conditions_paiement ?? '15 jours');

  // Client
  const [interventionId, setInterventionId] = useState<string | null>(initial?.intervention_id ?? null);
  const [organisationId, setOrganisationId] = useState<string | null>(initial?.organisation_id ?? null);
  const [clientId, setClientId] = useState<string | null>(initial?.client_id ?? null);
  const [clientNom, setClientNom] = useState<string>(initial?.client_nom ?? '');
  const [clientEmail, setClientEmail] = useState<string>(initial?.client_email ?? '');
  const [clientAdresse, setClientAdresse] = useState<string>(initial?.client_adresse ?? '');
  const [clientBce, setClientBce] = useState<string>(initial?.client_bce ?? '');
  const [clientSyndic, setClientSyndic] = useState<string>(initial?.client_syndic ?? '');

  // Recherche client (DB clients)
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [showQuickClientForm, setShowQuickClientForm] = useState(false);
  const [quickClientType, setQuickClientType] = useState<TypeClient>('acp');
  const [quickClientNom, setQuickClientNom] = useState('');
  const [quickClientEmail, setQuickClientEmail] = useState('');
  const [quickClientBce, setQuickClientBce] = useState('');
  const [quickClientPending, setQuickClientPending] = useState(false);

  // Lignes
  const [lignes, setLignes] = useState<FactureLigne[]>(
    initial?.lignes && initial.lignes.length > 0
      ? initial.lignes
      : [{ description: '', quantite: 1, prix_unitaire: 0, tva_pct: 21 }],
  );

  // Détails intervention
  const [details, setDetails] = useState<FactureDetailsIntervention>(initial?.details_intervention ?? {});
  const [showDetails, setShowDetails] = useState<boolean>(
    !!(initial?.details_intervention && Object.values(initial.details_intervention).some(Boolean)),
  );

  // Notes / remarques
  const [remarques, setRemarques] = useState<string>(initial?.remarques ?? '');
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  // TVA / remise
  const [tvaPct, setTvaPct] = useState<number>(initial?.tva_pct ?? 21);
  const [remisePct, setRemisePct] = useState<number>(initial?.remise_pct ?? 0);

  // Recherche intervention
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<InterventionRef[]>([]);

  useEffect(() => {
    if (!linked) return;
    if (interventionId) return;
    const q = searchQuery.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchInterventionsForFacture(q);
      if (res.ok) setSearchResults(res.data ?? []);
    }, 280);
    return () => clearTimeout(t);
  }, [searchQuery, interventionId, linked]);

  // Recherche client (DB clients) — actif quand pas d'intervention liée
  useEffect(() => {
    if (clientId) return;
    const q = clientQuery.trim();
    if (q.length < 2) { setClientResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchClients(q);
      if (res.ok) setClientResults(res.data ?? []);
    }, 280);
    return () => clearTimeout(t);
  }, [clientQuery, clientId]);

  function pickClient(c: Client) {
    setClientId(c.id);
    setClientNom([c.prenom, c.nom].filter(Boolean).join(' '));
    setClientEmail(c.email ?? '');
    setClientAdresse([c.adresse, c.code_postal, c.ville].filter(Boolean).join(', '));
    setClientBce(c.bce ?? '');
    setClientSyndic(
      c.type === 'acp' ? 'Syndic' :
      c.type === 'particulier' ? 'Particulier' :
      'Entreprise',
    );
    setClientQuery('');
    setClientResults([]);
    setShowQuickClientForm(false);
  }

  function clearClientLink() {
    setClientId(null);
  }

  async function createQuickClient() {
    if (!quickClientNom.trim()) {
      setFeedback({ kind: 'err', msg: 'Nom requis pour créer un client.' });
      return;
    }
    setQuickClientPending(true);
    try {
      const res = await saveClient({
        type: quickClientType,
        nom: quickClientNom,
        email: quickClientEmail,
        bce: quickClientBce,
      });
      if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
      // Re-fetch et auto-sélection
      const search = await searchClients(quickClientNom);
      const created = search.ok ? (search.data ?? []).find((c) => c.id === res.data!.id) : null;
      if (created) {
        pickClient(created);
        setFeedback({ kind: 'ok', msg: 'Client créé et sélectionné.' });
      }
      setQuickClientNom('');
      setQuickClientEmail('');
      setQuickClientBce('');
    } finally {
      setQuickClientPending(false);
    }
  }

  async function pickIntervention(id: string) {
    const res = await loadInterventionForFacture(id);
    if (!res.ok) { setFeedback({ kind: 'err', msg: res.error }); return; }
    const d = res.data!;
    setInterventionId(id);
    setOrganisationId(d.organisation_id);
    setClientNom(d.client_nom ?? '');
    setClientEmail(d.client_email ?? '');
    setClientAdresse(d.client_adresse ?? '');
    setClientBce(d.client_bce ?? '');
    setClientSyndic(d.client_syndic ?? '');
    setDetails(d.details);
    setShowDetails(true);
    if (d.ref) setReference(d.ref);
    setSearchResults([]);
    setSearchQuery('');
  }

  function clearIntervention() {
    setInterventionId(null);
    setOrganisationId(null);
    setClientNom('');
    setClientEmail('');
    setClientAdresse('');
    setClientBce('');
    setClientSyndic('');
    setDetails({});
  }

  // Lignes helpers
  function addLigne(article?: Article) {
    setLignes((arr) => [
      ...arr,
      article
        ? {
            description: article.description,
            quantite: 1,
            prix_unitaire: Number(article.prix_htva),
            tva_pct: Number(article.tva_pct ?? tvaPct),
            article_code: article.code ?? undefined,
          }
        : { description: '', quantite: 1, prix_unitaire: 0, tva_pct: tvaPct },
    ]);
  }
  function removeLigne(i: number) {
    setLignes((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));
  }
  function updateLigne(i: number, patch: Partial<FactureLigne>) {
    setLignes((arr) => arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  const totals = useMemo(() => computeFactureTotals(lignes, tvaPct, remisePct), [lignes, tvaPct, remisePct]);
  const bbaPreview = useMemo(() => generateBBA(numero || 'FV0000-000'), [numero]);

  function buildInput(statut?: StatutFacture): FactureInput {
    return {
      id: initial?.id,
      numero,
      intervention_id: linked ? interventionId : null,
      organisation_id: linked ? organisationId : null,
      client_id: clientId,
      client_nom: clientNom || null,
      client_email: clientEmail || null,
      client_adresse: clientAdresse || null,
      client_bce: clientBce || null,
      client_syndic: clientSyndic || null,
      lignes,
      details_intervention: showDetails ? details : {},
      remise_pct: remisePct,
      tva_pct: tvaPct,
      notes: notes || null,
      remarques: remarques || null,
      conditions_paiement: conditionsPaiement,
      reference: reference || null,
      date_emission: dateEmission,
      date_echeance: dateEcheance,
      statut,
    };
  }

  function handleSave(asEnvoyee = false) {
    setFeedback(null);
    startTransition(async () => {
      const res = await saveFacture(buildInput());
      if (!res.ok) {
        setFeedback({ kind: 'err', msg: res.error });
        return;
      }
      const id = res.data!.id;
      if (asEnvoyee) {
        const r2 = await setFactureStatut(id, 'envoyee');
        if (!r2.ok) {
          setFeedback({ kind: 'err', msg: r2.error });
          return;
        }
      }
      setFeedback({ kind: 'ok', msg: asEnvoyee ? 'Facture émise.' : 'Brouillon enregistré.' });
      router.push(`/admin/facturation/${id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5 max-w-[960px] pb-[calc(100px+env(safe-area-inset-bottom,0px))] sm:pb-4">
      {/* Toggle liée / hors intervention */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-2 dark:text-[#C8C2B8]">
          Type de facture
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setLinked(true)}
            className={
              'px-4 py-2.5 rounded-lg text-[13px] font-bold border-2 ' +
              (linked
                ? 'bg-navy text-white border-navy'
                : 'bg-white text-ink border-sand-border hover:border-navy-mid dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
            }
          >
            🔗 Liée à une intervention
          </button>
          <button
            type="button"
            onClick={() => { setLinked(false); clearIntervention(); }}
            className={
              'px-4 py-2.5 rounded-lg text-[13px] font-bold border-2 ' +
              (!linked
                ? 'bg-[#A17244] text-white border-[#A17244]'
                : 'bg-white text-ink border-sand-border hover:border-[#A17244] dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
            }
          >
            ✏ Hors intervention
          </button>
        </div>
      </div>

      {/* Recherche intervention */}
      {linked && (
        <div className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
          <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-2 dark:text-[#C8C2B8]">
            Intervention
          </div>
          {interventionId ? (
            <div className="bg-navy-pale border border-navy-light rounded-lg p-3 flex items-start justify-between gap-3 dark:bg-[#1B3A6B] dark:border-[#2A5298]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-navy/70 font-bold dark:text-white/70">
                  Sélectionnée
                </div>
                <div className="font-bold text-[14px] text-navy mt-0.5 dark:text-white">
                  {reference || 'Sans référence'}
                </div>
                <div className="text-xs text-navy/80 mt-0.5 dark:text-white/80">
                  {clientNom} {clientSyndic ? `(${clientSyndic})` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={clearIntervention}
                className="text-[11px] text-navy underline hover:no-underline dark:text-white"
              >
                Changer
              </button>
            </div>
          ) : (
            <>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher par référence ou description…"
                className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
              />
              {searchResults.length > 0 && (
                <div className="mt-2 bg-white border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[200px] overflow-y-auto dark:bg-[#221E1A] dark:border-[#3D3A32] dark:divide-[#3D3A32]">
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pickIntervention(r.id)}
                      className="block w-full text-left px-3.5 py-2 text-[12px] hover:bg-sand dark:hover:bg-[#2A2520] dark:text-[#F0ECE4]"
                    >
                      <span className="font-mono font-bold text-navy dark:text-[#A8C4F2]">{r.ref ?? '—'}</span>
                      {' · '}
                      <span>{r.acp_nom ?? '—'}</span>
                      <span className="text-ink-muted dark:text-[#C8C2B8]"> — {r.syndic_nom ?? '—'}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Identification (3 colonnes) */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-3 dark:text-[#C8C2B8]">
          Identification
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="N° de facture *" value={numero} onChange={setNumero} placeholder="FV2026-100" mono />
          <Field label="Date de facturation *" type="date" value={dateEmission} onChange={(v) => {
            setDateEmission(v);
            setDateEcheance(plusDaysISO(v, 15));
          }} />
          <Field label="Date d'échéance *" type="date" value={dateEcheance} onChange={setDateEcheance} />
          <Field label="Référence" value={reference} onChange={setReference} placeholder="2026-100 Rue Willems 14" />
          <Field label="Conditions de paiement" value={conditionsPaiement} onChange={setConditionsPaiement} placeholder="15 jours" />
          <div>
            <Label>Communication structurée (auto)</Label>
            <div className="font-mono text-[13px] text-navy bg-navy-pale border border-navy-light rounded-lg px-3 py-2.5 dark:bg-[#1B3A6B] dark:text-white dark:border-[#2A5298]">
              {bbaPreview}
            </div>
          </div>
        </div>
      </div>

      {/* Client */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest dark:text-[#C8C2B8]">
            Client
          </div>
          {clientId && (
            <button
              type="button"
              onClick={clearClientLink}
              className="text-[11px] text-ink-mid hover:text-navy underline dark:text-[#C8C2B8]"
            >
              Délier le client
            </button>
          )}
        </div>

        {/* Recherche dans la base clients */}
        <div className="mb-3">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label>Rechercher dans la base clients</Label>
              <input
                value={clientQuery}
                onChange={(e) => setClientQuery(e.target.value)}
                placeholder="Nom, BCE ou email…"
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setShowQuickClientForm((v) => !v);
                if (!showQuickClientForm) setQuickClientNom(clientNom);
              }}
              className="bg-[#A17244] text-white px-3 py-2 rounded-lg text-[12px] font-bold hover:opacity-90"
            >
              + Nouveau
            </button>
          </div>
          {clientResults.length > 0 && (
            <div className="mt-2 bg-white border border-sand-border rounded-lg divide-y divide-sand-mid max-h-[180px] overflow-y-auto dark:bg-[#221E1A] dark:border-[#3D3A32] dark:divide-[#3D3A32]">
              {clientResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickClient(c)}
                  className="block w-full text-left px-3 py-2 text-[12px] hover:bg-sand dark:hover:bg-[#2A2520] dark:text-[#F0ECE4]"
                >
                  <div className="font-bold">
                    {[c.prenom, c.nom].filter(Boolean).join(' ')}
                  </div>
                  <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8]">
                    {c.type.toUpperCase()}
                    {c.email ? ` · ${c.email}` : ''}
                    {c.bce ? ` · BCE ${c.bce}` : ''}
                  </div>
                </button>
              ))}
            </div>
          )}

          {showQuickClientForm && (
            <div className="mt-2 bg-amber-light border border-[#E8C896] rounded-lg p-3 space-y-2 dark:bg-[#2A220E] dark:border-[#5A4A30]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#8A5A1A] dark:text-[#E8C896]">
                Nouveau client (rapide)
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(['acp', 'particulier', 'entreprise'] as TypeClient[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setQuickClientType(t)}
                    className={
                      'px-2 py-1.5 rounded-md text-[11px] font-bold border ' +
                      (quickClientType === t
                        ? 'bg-navy text-white border-navy'
                        : 'bg-white text-ink-mid border-sand-border dark:bg-[#221E1A] dark:text-[#F0ECE4] dark:border-[#3D3A32]')
                    }
                  >
                    {t === 'acp' ? 'ACP' : t === 'particulier' ? 'Particulier' : 'Entreprise'}
                  </button>
                ))}
              </div>
              <input
                value={quickClientNom}
                onChange={(e) => setQuickClientNom(e.target.value)}
                placeholder="Nom *"
                className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  value={quickClientEmail}
                  onChange={(e) => setQuickClientEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white"
                />
                <input
                  value={quickClientBce}
                  onChange={(e) => setQuickClientBce(e.target.value)}
                  placeholder="BCE"
                  className="w-full px-3 py-2 border border-sand-border rounded-lg text-[13px] bg-white font-mono"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuickClientForm(false)}
                  className="text-[11px] text-ink-mid underline dark:text-[#C8C2B8]"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={createQuickClient}
                  disabled={quickClientPending}
                  className="bg-navy text-white px-3 py-1.5 rounded-md text-[12px] font-bold hover:opacity-90 disabled:opacity-50"
                >
                  {quickClientPending ? '…' : 'Créer & sélectionner'}
                </button>
              </div>
            </div>
          )}

          {clientId && (
            <div className="mt-2 text-[11px] text-ok bg-ok-light border border-ok-mid rounded-md px-2.5 py-1.5 font-semibold dark:bg-[#1F6B45] dark:text-white dark:border-[#2A8A5A]">
              ✓ Client lié à la base — modifications sur ce formulaire restent locales à la facture
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Nom du client *" value={clientNom} onChange={setClientNom} />
          <Field label="Type / Syndic" value={clientSyndic} onChange={setClientSyndic} placeholder="Syndic / Courtier / —" />
          <Field label="Email" type="email" value={clientEmail} onChange={setClientEmail} />
          <Field label="BCE" value={clientBce} onChange={setClientBce} placeholder="BE0..." />
          <div className="sm:col-span-2">
            <Label>Adresse</Label>
            <textarea
              value={clientAdresse}
              onChange={(e) => setClientAdresse(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
            />
          </div>
        </div>
      </div>

      {/* Lignes prestations */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest dark:text-[#C8C2B8]">
            Prestations
          </div>
          <select
            onChange={(e) => {
              const a = articles.find((x) => x.id === e.target.value);
              if (a) addLigne(a);
              e.target.value = '';
            }}
            value=""
            className="text-[11px] px-2 py-1 border border-sand-border rounded-md bg-white cursor-pointer dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
          >
            <option value="">+ Article catalogue</option>
            {articles.map((a) => {
              const tvaPctA = Number(a.tva_pct ?? 21);
              const ttc = htvaToTtc(Number(a.prix_htva), tvaPctA);
              return (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.description.slice(0, 45)} · {fmtMoney(ttc)} € TTC
                </option>
              );
            })}
          </select>
        </div>

        <div className="space-y-2">
          {lignes.map((l, i) => (
            <div key={i} className="bg-white border border-sand-border rounded-lg p-3 space-y-2 dark:bg-[#221E1A] dark:border-[#3D3A32]">
              <div className="flex items-start gap-2">
                <input
                  value={l.description}
                  onChange={(e) => updateLigne(i, { description: e.target.value })}
                  placeholder="Description de la prestation"
                  className="flex-1 px-2.5 py-1.5 border border-sand-border rounded-md text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
                />
                {lignes.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLigne(i)}
                    className="text-terra hover:underline text-[11px] font-semibold flex-shrink-0"
                  >
                    Retirer
                  </button>
                )}
              </div>
              <input
                value={l.notes ?? ''}
                onChange={(e) => updateLigne(i, { notes: e.target.value })}
                placeholder="Notes (italique sous la description sur le PDF) — ex : Apt 1706-1806, Rue Willems 14"
                className="w-full px-2.5 py-1.5 border border-sand-border rounded-md text-[12px] italic bg-white outline-none focus:border-navy-mid dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#C8C2B8]"
              />
              <div className="grid grid-cols-4 gap-2">
                <NumField label="Qté" value={l.quantite} step="1" onChange={(v) => updateLigne(i, { quantite: v })} />
                <NumField
                  label="P.U. TTC"
                  value={htvaToTtc(l.prix_unitaire, l.tva_pct)}
                  step="0.01"
                  onChange={(ttc) => updateLigne(i, { prix_unitaire: ttcToHtva(ttc, l.tva_pct) })}
                />
                <NumField label="TVA %" value={l.tva_pct} step="1" onChange={(v) => updateLigne(i, { tva_pct: v })} />
                <div>
                  <Label>Total TTC</Label>
                  <div className="px-2.5 py-1.5 text-[13px] font-mono font-bold text-navy dark:text-white">
                    {fmtMoney(l.quantite * htvaToTtc(l.prix_unitaire, l.tva_pct))} €
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-ink-muted dark:text-[#C8C2B8] flex flex-wrap gap-3 pt-1 border-t border-sand-border dark:border-[#3D3A32]">
                <span>HTVA unitaire : <span className="font-mono">{fmtMoney(l.prix_unitaire)} €</span></span>
                <span>HTVA total : <span className="font-mono">{fmtMoney(l.quantite * l.prix_unitaire)} €</span></span>
                <span>TVA {l.tva_pct}% : <span className="font-mono">{fmtMoney(l.quantite * (htvaToTtc(l.prix_unitaire, l.tva_pct) - l.prix_unitaire))} €</span></span>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => addLigne()}
          className="mt-2 bg-sand-mid text-ink-mid border border-sand-border px-3 py-1.5 rounded-md text-[11px] font-semibold hover:bg-sand-hover dark:bg-[#221E1A] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
        >
          + Ligne libre
        </button>
      </div>

      {/* Détails intervention (optionnel) */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest dark:text-[#C8C2B8]">
            Détails intervention
          </div>
          <label className="flex items-center gap-2 text-[12px] text-ink-mid cursor-pointer dark:text-[#C8C2B8]">
            <input
              type="checkbox"
              checked={showDetails}
              onChange={(e) => setShowDetails(e.target.checked)}
              className="accent-[#1B3A6B]"
            />
            Afficher sur la facture
          </label>
        </div>
        {showDetails && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Référence dossier" value={details.ref_dossier ?? ''} onChange={(v) => setDetails({ ...details, ref_dossier: v })} placeholder="2026-100" />
            <Field label="Appartements concernés" value={details.appartements ?? ''} onChange={(v) => setDetails({ ...details, appartements: v })} placeholder="Apt 1706 - 1806" />
            <Field label="Adresse intervention" value={details.adresse_intervention ?? ''} onChange={(v) => setDetails({ ...details, adresse_intervention: v })} placeholder="Rue Willems 14, 1000 Bruxelles" />
            <Field label="Référence assurance / courtier" value={details.reference_assurance ?? ''} onChange={(v) => setDetails({ ...details, reference_assurance: v })} placeholder="Ettik / B-Safe / SIN-…" />
          </div>
        )}
      </div>

      {/* Notes / remarques */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="text-[11px] font-bold text-ink-muted uppercase tracking-widest mb-3 dark:text-[#C8C2B8]">
          Notes / Remarques
        </div>
        <textarea
          value={remarques}
          onChange={(e) => setRemarques(e.target.value)}
          rows={3}
          placeholder="Remarques visibles sur le PDF (ex: « Travaux à réaliser dans les plus brefs délais »)"
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y mb-2 dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Notes internes (apparaissent aussi sur le PDF en complément)"
          className="w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid resize-y dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
        />
      </div>

      {/* TVA + totaux */}
      <div className="bg-cream border border-sand-border rounded-2xl p-4 dark:bg-[#1C1A16] dark:border-[#3D3A32]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <NumField label="Taux TVA %" value={tvaPct} step="1" onChange={setTvaPct} />
          <NumField label="Remise %" value={remisePct} step="1" onChange={setRemisePct} />
        </div>
        <div className="border-t border-sand-border pt-3 dark:border-[#3D3A32]">
          <div className="flex justify-between text-[13px] py-1 dark:text-[#F0ECE4]">
            <span>Montant HT</span>
            <span className="font-mono">{fmtMoney(totals.ht)} €</span>
          </div>
          <div className="flex justify-between text-[13px] py-1 text-ink-mid dark:text-[#C8C2B8]">
            <span>TVA {tvaPct}%</span>
            <span className="font-mono">{fmtMoney(totals.tva)} €</span>
          </div>
          <div className="flex justify-between text-[15px] font-extrabold text-navy py-2 border-t border-sand-border dark:border-[#3D3A32] dark:text-white">
            <span>Total TTC</span>
            <span className="font-mono">{fmtMoney(totals.ttc)} €</span>
          </div>
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

      {/* Actions — sticky en bas, ancré au-dessus de la bottom nav mobile.
          pb-5 (20px) = padding interne + 8px supplémentaires pour respirer. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sticky bottom-[calc(72px+env(safe-area-inset-bottom,0px))] sm:bottom-0 bg-sand pt-3 pb-5 sm:pb-3 -mx-2 px-2 dark:bg-[#141210] z-10 border-t border-sand-border dark:border-[#2C2A24]">
        <button
          type="button"
          onClick={() => handleSave(false)}
          disabled={pending}
          className="bg-[#A17244] text-white py-3 rounded-xl font-bold text-[13px] hover:bg-[#8A613B] disabled:opacity-50 min-h-[52px] sm:min-h-0"
        >
          {pending ? '…' : 'Enregistrer brouillon'}
        </button>
        <button
          type="button"
          onClick={() => handleSave(true)}
          disabled={pending}
          className="bg-navy text-white py-3 rounded-xl font-bold text-[13px] hover:opacity-90 disabled:opacity-50 min-h-[52px] sm:min-h-0"
        >
          ✓ Émettre la facture
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, mono,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; mono?: boolean;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          'w-full px-3 py-2.5 border border-sand-border rounded-lg text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4] ' +
          (mono ? 'font-mono' : '')
        }
      />
    </div>
  );
}

function NumField({
  label, value, onChange, step,
}: {
  label: string; value: number; onChange: (v: number) => void; step?: string;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="number"
        step={step ?? 'any'}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-2.5 py-1.5 border border-sand-border rounded-md text-[13px] bg-white outline-none focus:border-navy-mid font-mono dark:bg-[#1C1A16] dark:border-[#3D3A32] dark:text-[#F0ECE4]"
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-ink-mid block mb-1.5 dark:text-[#C8C2B8]">
      {children}
    </label>
  );
}
