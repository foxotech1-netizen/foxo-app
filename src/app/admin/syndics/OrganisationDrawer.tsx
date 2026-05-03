'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TypeBadge } from '@/components/TypeBadge';
import type { Organisation, Delegue, DelegueRole, TypeOrganisation } from '@/lib/types/database';

type Tab = 'infos' | 'delegues' | 'acps';

interface AcpListItem {
  id: string;
  nom: string | null;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  intervention_count: number;
}

type DelegueFormDraft = {
  email: string;
  prenom: string;
  nom: string;
  telephone: string;
  role: DelegueRole;
};

const EMPTY_DRAFT: DelegueFormDraft = {
  email: '', prenom: '', nom: '', telephone: '', role: 'delegue',
};

export function OrganisationDrawer({
  org, onClose, onUpdate,
}: {
  org: Organisation;
  onClose: () => void;
  /** Propage les changements de la fiche vers la liste (mise à jour
   *  optimiste). Le drawer ne mute jamais le prop `org` directement. */
  onUpdate?: (updated: Partial<Organisation>) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('infos');
  const [delegues, setDelegues] = useState<Delegue[]>([]);
  const [acps, setAcps] = useState<AcpListItem[]>([]);
  const [acpsLoading, setAcpsLoading] = useState(false);
  const [acpsError, setAcpsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DelegueFormDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  async function loadDelegues() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/syndics/${org.id}/delegues`, { cache: 'no-store' });
      const data = await r.json();
      if (!data.ok) { setError(data.error ?? 'Erreur'); return; }
      setDelegues(data.delegues ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setLoading(false);
    }
  }

  async function loadAcps() {
    setAcpsLoading(true);
    setAcpsError(null);
    try {
      const r = await fetch(`/api/admin/syndics/${org.id}/acps`, { cache: 'no-store' });
      const data = await r.json();
      if (!data.ok) { setAcpsError(data.error ?? 'Erreur'); return; }
      setAcps(data.acps ?? []);
    } catch (e) {
      setAcpsError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setAcpsLoading(false);
    }
  }

  useEffect(() => {
    if (tab === 'delegues') loadDelegues();
    if (tab === 'acps') loadAcps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, org.id]);

  function startEdit(d: Delegue) {
    setEditingId(d.id);
    setAdding(false);
    setDraft({
      email: d.email,
      prenom: d.prenom ?? '',
      nom: d.nom ?? '',
      telephone: d.telephone ?? '',
      role: d.role,
    });
  }

  function startAdd() {
    setEditingId(null);
    setAdding(true);
    setDraft(EMPTY_DRAFT);
  }

  function cancelForm() {
    setEditingId(null);
    setAdding(false);
    setDraft(EMPTY_DRAFT);
  }

  async function saveDelegue() {
    if (!draft.email.trim() || !draft.email.includes('@')) {
      setFeedback({ kind: 'err', msg: 'Email valide requis.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const url = editingId
        ? `/api/admin/syndics/${org.id}/delegues/${editingId}`
        : `/api/admin/syndics/${org.id}/delegues`;
      const method = editingId ? 'PATCH' : 'POST';
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Échec sauvegarde.' });
        return;
      }
      cancelForm();
      await loadDelegues();
      setFeedback({ kind: 'ok', msg: editingId ? 'Modifié ✓' : 'Délégué ajouté ✓' });
    } finally {
      setSaving(false);
    }
  }

  async function deleteDelegue(id: string) {
    if (!confirm('Supprimer ce délégué ?')) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/syndics/${org.id}/delegues/${id}`, { method: 'DELETE' });
      const data = await r.json();
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Échec suppression.' });
        return;
      }
      await loadDelegues();
      setFeedback({ kind: 'ok', msg: 'Supprimé ✓' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActif(d: Delegue) {
    setSaving(true);
    try {
      await fetch(`/api/admin/syndics/${org.id}/delegues/${d.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actif: !d.actif }),
      });
      await loadDelegues();
    } finally {
      setSaving(false);
    }
  }

  async function sendInvite(id: string) {
    setInvitingId(id);
    setFeedback(null);
    try {
      const r = await fetch(`/api/admin/syndics/${org.id}/delegues/${id}/invite`, { method: 'POST' });
      const data = await r.json();
      if (!data.ok) {
        if (data.code === 'google_not_connected') {
          setFeedback({ kind: 'err', msg: 'Google non connecté — connecte le compte dans /admin/parametres.' });
        } else {
          setFeedback({ kind: 'err', msg: data.error ?? 'Échec envoi invitation.' });
        }
        return;
      }
      await loadDelegues();
      setFeedback({ kind: 'ok', msg: 'Invitation envoyée ✓' });
    } finally {
      setInvitingId(null);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 bg-navy-deep/45 z-50 flex justify-end"
    >
      <div className="w-[480px] max-w-full bg-cream h-screen overflow-y-auto shadow-2xl border-l border-sand-border flex flex-col dark:bg-[#1C1A16] dark:border-[#2C2A24]">
        <header className="px-5 pt-5 pb-3 bg-sand border-b border-sand-border dark:bg-[#141210] dark:border-[#2C2A24]">
          <div className="flex justify-between items-start">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <TypeBadge type={org.type} />
                {org.bce && <span className="font-mono text-[10px] text-ink-muted dark:text-[#C8C2B8]">{org.bce}</span>}
              </div>
              <h2 className="text-base font-extrabold text-ink truncate dark:text-[#F0ECE4]">{org.nom}</h2>
              <div className="text-[11px] text-ink-mid mt-0.5 dark:text-[#C8C2B8] font-mono">{org.email}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="bg-sand-mid w-8 h-8 rounded-md text-ink-mid hover:bg-sand-border flex-shrink-0 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
            >✕</button>
          </div>
        </header>

        <nav className="flex bg-cream px-5 border-b border-sand-border dark:bg-[#1C1A16] dark:border-[#2C2A24]">
          {(['infos', 'delegues', 'acps'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`py-2.5 px-4 text-xs font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'text-navy border-navy font-bold dark:text-[#A8C4F2] dark:border-[#A8C4F2]'
                  : 'text-ink-muted border-transparent hover:text-ink-mid dark:text-[#C8C2B8]'
              }`}
            >
              {t === 'infos' ? 'Infos' : t === 'delegues' ? '👥 Délégués' : '🏢 ACPs'}
            </button>
          ))}
        </nav>

        <div className="px-5 py-4 flex-1 overflow-y-auto bg-sand dark:bg-[#141210]">
          {feedback && (
            <div className={
              'mb-3 px-3 py-2 text-[12px] font-semibold border rounded-md ' +
              (feedback.kind === 'ok'
                ? 'bg-ok-light border-ok-mid text-ok dark:bg-[#14281E] dark:border-[#2A4F3A] dark:text-[#7AC9A0]'
                : 'bg-terra-light border-terra-mid text-terra')
            }>
              {feedback.msg}
            </div>
          )}

          {tab === 'infos' && (
            <>
              <SyndicInfosBlock
                org={org}
                onSaved={(updated) => {
                  onUpdate?.(updated);
                  setFeedback({ kind: 'ok', msg: 'Infos sauvegardées ✓' });
                }}
              />
              <SyndicEmailsBlock
                org={org}
                onSaved={(updated) => {
                  onUpdate?.(updated);
                  setFeedback({ kind: 'ok', msg: 'Emails dédiés sauvegardés ✓' });
                }}
              />
            </>
          )}

          {tab === 'delegues' && (
            <>
              {loading && <div className="text-[12px] text-ink-muted dark:text-[#C8C2B8]">Chargement…</div>}
              {error && (
                <div className="bg-terra-light border border-terra-mid text-terra rounded-md px-3 py-2 text-[12px] font-semibold mb-2">
                  {error}
                </div>
              )}

              <div className="space-y-1.5 mb-3">
                {delegues.map((d) => {
                  if (editingId === d.id) {
                    return (
                      <DelegueEditCard
                        key={d.id}
                        draft={draft}
                        onChange={setDraft}
                        onSave={saveDelegue}
                        onCancel={cancelForm}
                        saving={saving}
                      />
                    );
                  }
                  const fullName = [d.prenom, d.nom].filter(Boolean).join(' ') || d.email;
                  const status = !d.actif
                    ? { label: '❌ Inactif', cls: 'text-terra' }
                    : d.invite_sent_at
                      ? { label: '✅ Actif', cls: 'text-ok dark:text-[#7AC9A0]' }
                      : { label: '⏳ Pas encore invité', cls: 'text-[#8A5A1A] dark:text-[#E8C896]' };
                  return (
                    <div key={d.id} className="bg-cream border border-sand-border rounded-md px-3 py-2 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="font-bold text-[13px] text-ink dark:text-[#F0ECE4] truncate">{fullName}</span>
                        <span
                          className={
                            'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ' +
                            (d.role === 'admin'
                              ? 'bg-navy text-white'
                              : 'bg-sand-mid text-ink-mid dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]')
                          }
                        >
                          {d.role === 'admin' ? 'Admin' : 'Délégué'}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-ink-muted dark:text-[#C8C2B8]">
                        {d.email}{d.telephone ? ` · ${d.telephone}` : ''}
                      </div>
                      <div className={'text-[10px] font-semibold mt-1 ' + status.cls}>
                        {status.label}
                        {d.invite_sent_at && (
                          <span className="text-ink-muted ml-1.5 font-normal dark:text-[#C8C2B8]">
                            (invité le {new Date(d.invite_sent_at).toLocaleDateString('fr-BE')})
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <button
                          type="button"
                          onClick={() => startEdit(d)}
                          className="text-[10px] bg-sand-mid text-ink-mid border border-sand-border px-2 py-1 rounded font-bold dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
                        >
                          ✏️ Modifier
                        </button>
                        <button
                          type="button"
                          onClick={() => sendInvite(d.id)}
                          disabled={invitingId === d.id}
                          className="text-[10px] bg-navy text-white px-2 py-1 rounded font-bold disabled:opacity-50"
                        >
                          {invitingId === d.id ? 'Envoi…' : (d.invite_sent_at ? '📤 Renvoyer invitation' : '📤 Envoyer invitation')}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActif(d)}
                          disabled={saving}
                          className="text-[10px] bg-amber-light text-[#8A5A1A] border border-[#E8C896] px-2 py-1 rounded font-bold dark:bg-[#2A220E] dark:text-[#E8C896] dark:border-[#5A4A30]"
                        >
                          {d.actif ? '🚫 Désactiver' : '✓ Activer'}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteDelegue(d.id)}
                          disabled={saving}
                          className="text-[10px] bg-terra-light text-terra border border-terra-mid px-2 py-1 rounded font-bold dark:bg-[#5A2E18] dark:text-[#FFB897] dark:border-[#7A3F22]"
                        >
                          🗑 Supprimer
                        </button>
                      </div>
                    </div>
                  );
                })}

                {adding && (
                  <DelegueEditCard
                    draft={draft}
                    onChange={setDraft}
                    onSave={saveDelegue}
                    onCancel={cancelForm}
                    saving={saving}
                  />
                )}

                {!adding && !editingId && (
                  <button
                    type="button"
                    onClick={startAdd}
                    className="w-full text-[12px] bg-cream text-navy border border-navy border-dashed rounded-md px-3 py-2 font-bold hover:bg-navy-pale dark:bg-[#1C1A16] dark:border-[#2A5298] dark:text-[#A8C4F2]"
                  >
                    ➕ Ajouter un délégué
                  </button>
                )}
              </div>

              {!loading && delegues.length === 0 && !adding && (
                <p className="text-[12px] text-ink-muted italic dark:text-[#C8C2B8]">
                  Aucun délégué pour le moment. Ajoute-en un pour donner accès au portail.
                </p>
              )}
            </>
          )}

          {tab === 'acps' && (
            <>
              {acpsLoading && <div className="text-[12px] text-ink-muted dark:text-[#C8C2B8]">Chargement…</div>}
              {acpsError && (
                <div className="bg-terra-light border border-terra-mid text-terra rounded-md px-3 py-2 text-[12px] font-semibold mb-2">
                  {acpsError}
                </div>
              )}

              <div className="space-y-1.5 mb-3">
                {acps.map((a) => {
                  const adresseShort = [a.adresse, [a.code_postal, a.ville].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        // Filtre exact la liste interventions sur acp_id
                        // (cf. searchParams.get('acp_id') dans InterventionsClient).
                        router.push(`/admin?acp_id=${encodeURIComponent(a.id)}`);
                        onClose();
                      }}
                      className="w-full text-left bg-cream border border-sand-border rounded-md px-3 py-2 hover:bg-sand-hover dark:bg-[#1C1A16] dark:border-[#2C2A24] dark:hover:bg-[#221E1A]"
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="font-bold text-[13px] text-ink dark:text-[#F0ECE4] truncate">
                          {a.nom ?? '—'}
                        </span>
                        <span
                          className={
                            'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap ' +
                            (a.intervention_count > 0
                              ? 'bg-navy text-white'
                              : 'bg-sand-mid text-ink-muted dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]')
                          }
                          title={`${a.intervention_count} intervention(s)`}
                        >
                          {a.intervention_count} interv.
                        </span>
                      </div>
                      {adresseShort && (
                        <div className="text-[11px] text-ink-mid dark:text-[#C8C2B8]">{adresseShort}</div>
                      )}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    // Pré-remplit ClientForm via query params : type=acp +
                    // syndic_id=<org.id> (cf. lecture useSearchParams dans
                    // src/app/admin/clients/ClientForm.tsx).
                    router.push(`/admin/clients/new?type=acp&syndic_id=${org.id}`);
                    onClose();
                  }}
                  className="w-full text-[12px] bg-cream text-navy border border-navy border-dashed rounded-md px-3 py-2 font-bold hover:bg-navy-pale dark:bg-[#1C1A16] dark:border-[#2A5298] dark:text-[#A8C4F2]"
                >
                  ➕ Ajouter une ACP
                </button>
              </div>

              {!acpsLoading && acps.length === 0 && (
                <p className="text-[12px] text-ink-muted italic dark:text-[#C8C2B8]">
                  Aucune ACP rattachée à ce {org.type === 'syndic' ? 'syndic' : 'courtier'}. Crée-en une depuis la fiche client.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Bloc "Infos" éditable inline. Affiche les 7 champs en lecture par
// défaut, bascule en mode édition au clic sur "✏️ Modifier" — bouton
// Sauvegarder applique un PATCH /api/admin/syndics/[id] avec les
// champs modifiés, et propage la mise à jour optimiste au parent via
// onSaved. Annuler restaure les valeurs initiales.
type InfosDraft = {
  nom: string;
  type: TypeOrganisation;
  email: string;
  contact: string;
  telephone: string;
  bce: string;
  adresse: string;
};

function draftFromOrg(o: Organisation): InfosDraft {
  return {
    nom:       o.nom ?? '',
    type:      o.type,
    email:     o.email ?? '',
    contact:   o.contact ?? '',
    telephone: o.telephone ?? '',
    bce:       o.bce ?? '',
    adresse:   o.adresse ?? '',
  };
}

function SyndicInfosBlock({
  org, onSaved,
}: {
  org: Organisation;
  onSaved: (updated: Partial<Organisation>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<InfosDraft>(draftFromOrg(org));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resync draft si le prop change pendant qu'on n'édite pas (ex : autre
  // bloc — emails dédiés — a propagé une mise à jour au parent qui
  // re-rend l'org). Pendant l'édition, on garde le draft local pour ne
  // pas écraser la saisie en cours. Pattern React 19 : storing prev props.
  const [lastOrg, setLastOrg] = useState(org);
  if (lastOrg !== org) {
    setLastOrg(org);
    if (!editing) setDraft(draftFromOrg(org));
  }

  function startEdit() {
    setDraft(draftFromOrg(org));
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setError(null);
    setEditing(false);
  }
  async function save() {
    // Validation client : nom et email principaux obligatoires
    const nomTrim = draft.nom.trim();
    const emailTrim = draft.email.trim();
    if (!nomTrim) { setError('Le nom est requis.'); return; }
    if (!emailTrim || !emailTrim.includes('@')) { setError('Email principal valide requis.'); return; }

    // Construit un payload diff (uniquement les champs modifiés)
    const payload: Record<string, string | null> = {};
    const stringKeys: (keyof InfosDraft)[] = ['nom', 'email', 'contact', 'telephone', 'bce', 'adresse'];
    for (const k of stringKeys) {
      const v = (draft[k] as string).trim();
      const orig = ((org[k] as string | null | undefined) ?? '');
      if (v !== orig) payload[k] = v || null;
    }
    if (draft.type !== org.type) payload.type = draft.type;

    if (Object.keys(payload).length === 0) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/syndics/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Échec sauvegarde.');
        return;
      }
      // Propage uniquement les champs réellement modifiés au parent.
      onSaved(payload as Partial<Organisation>);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full px-2 py-1.5 border border-sand-border rounded text-[13px] bg-white outline-none focus:border-navy-mid dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]';
  const monoInputCls = inputCls + ' font-mono text-[12px]';

  return (
    <div className="bg-cream border border-sand-border rounded-xl p-4 dark:bg-[#1C1A16] dark:border-[#2C2A24] mb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-muted dark:text-[#C8C2B8]">
          Infos
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="text-[11px] bg-sand-mid text-ink-mid border border-sand-border px-2.5 py-1 rounded font-bold hover:bg-sand-border dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8] dark:border-[#3D3A32]"
          >
            ✏️ Modifier
          </button>
        ) : (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={cancel}
              disabled={saving}
              className="text-[11px] bg-sand-mid text-ink-mid px-2.5 py-1 rounded font-bold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="text-[11px] bg-navy text-white px-2.5 py-1 rounded font-bold disabled:opacity-50"
            >
              {saving ? '…' : '💾 Sauvegarder'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-3 px-2.5 py-1.5 bg-terra-light border border-terra-mid text-terra rounded-md text-[11px] font-semibold">
          {error}
        </div>
      )}

      {editing ? (
        <div className="space-y-2.5">
          <InfoEditField label="Nom" required>
            <input value={draft.nom} onChange={(e) => setDraft({ ...draft, nom: e.target.value })} className={inputCls} />
          </InfoEditField>
          <InfoEditField label="Type">
            <select
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as TypeOrganisation })}
              className={inputCls}
            >
              <option value="syndic">Syndic</option>
              <option value="courtier">Courtier</option>
            </select>
          </InfoEditField>
          <InfoEditField label="Email principal" required>
            <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={monoInputCls} />
          </InfoEditField>
          <InfoEditField label="Contact">
            <input value={draft.contact} onChange={(e) => setDraft({ ...draft, contact: e.target.value })} className={inputCls} />
          </InfoEditField>
          <InfoEditField label="Téléphone">
            <input value={draft.telephone} onChange={(e) => setDraft({ ...draft, telephone: e.target.value })} className={monoInputCls} />
          </InfoEditField>
          <InfoEditField label="BCE">
            <input value={draft.bce} onChange={(e) => setDraft({ ...draft, bce: e.target.value })} className={monoInputCls} />
          </InfoEditField>
          <InfoEditField label="Adresse">
            <input value={draft.adresse} onChange={(e) => setDraft({ ...draft, adresse: e.target.value })} className={inputCls} />
          </InfoEditField>
        </div>
      ) : (
        <div className="space-y-2 text-[13px]">
          <KV label="Nom" value={org.nom} />
          <KV label="Type" value={org.type === 'syndic' ? 'Syndic' : 'Courtier'} />
          <KV label="Email principal" value={org.email} mono />
          <KV label="Contact" value={org.contact} />
          <KV label="Téléphone" value={org.telephone} mono />
          <KV label="BCE" value={org.bce} mono />
          <KV label="Adresse" value={org.adresse} />
        </div>
      )}
    </div>
  );
}

function InfoEditField({
  label, required, children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 items-center">
      <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-[#C8C2B8]">
        {label}{required && <span className="text-terra ml-0.5">*</span>}
      </label>
      <div className="col-span-2">
        {children}
      </div>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-muted dark:text-[#C8C2B8]">
        {label}
      </div>
      <div className={'col-span-2 text-[13px] dark:text-[#F0ECE4] ' + (mono ? 'font-mono text-[12px]' : '')}>
        {value || <span className="text-ink-muted italic dark:text-[#8A8278]">—</span>}
      </div>
    </div>
  );
}

function DelegueEditCard({
  draft, onChange, onSave, onCancel, saving,
}: {
  draft: DelegueFormDraft;
  onChange: (d: DelegueFormDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const cls = 'w-full px-2 py-1 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid';
  return (
    <div className="bg-navy-pale border border-navy-light rounded-md px-3 py-2.5 dark:bg-[#1A2540] dark:border-[#2C4878]">
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <input
          value={draft.prenom}
          onChange={(e) => onChange({ ...draft, prenom: e.target.value })}
          placeholder="Prénom"
          className={cls}
        />
        <input
          value={draft.nom}
          onChange={(e) => onChange({ ...draft, nom: e.target.value })}
          placeholder="Nom"
          className={cls}
        />
        <input
          type="email"
          value={draft.email}
          onChange={(e) => onChange({ ...draft, email: e.target.value })}
          placeholder="email *"
          className={cls + ' col-span-2 font-mono'}
        />
        <input
          value={draft.telephone}
          onChange={(e) => onChange({ ...draft, telephone: e.target.value })}
          placeholder="Téléphone"
          className={cls + ' font-mono'}
        />
        <select
          value={draft.role}
          onChange={(e) => onChange({ ...draft, role: e.target.value as DelegueRole })}
          className={cls}
        >
          <option value="delegue">Délégué</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-[10px] bg-sand-mid text-ink-mid px-2 py-1 rounded font-bold disabled:opacity-50 dark:bg-[rgba(255,255,255,.06)] dark:text-[#C8C2B8]"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="text-[10px] bg-navy text-white px-2 py-1 rounded font-bold disabled:opacity-50"
        >
          {saving ? '…' : '💾 Sauvegarder'}
        </button>
      </div>
    </div>
  );
}

// Section "📧 Emails dédiés" — éditable, appelle PATCH /api/admin/syndics/[id]
function SyndicEmailsBlock({
  org, onSaved,
}: {
  org: Organisation;
  onSaved: (updated: Partial<Organisation>) => void;
}) {
  const [factures, setFactures] = useState(org.email_factures ?? '');
  const [rapports, setRapports] = useState(org.email_rapports ?? '');
  const [communications, setCommunications] = useState(org.email_communications ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/syndics/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_factures: factures || null,
          email_rapports: rapports || null,
          email_communications: communications || null,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        alert(data.error ?? 'Échec sauvegarde.');
        return;
      }
      onSaved({
        email_factures: factures || null,
        email_rapports: rapports || null,
        email_communications: communications || null,
      });
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full px-2 py-1.5 border border-sand-border rounded text-[12px] bg-white outline-none focus:border-navy-mid font-mono dark:bg-[#221E1A] dark:border-[#3D3A32] dark:text-[#F0ECE4]';

  return (
    <div className="bg-cream border border-sand-border rounded-xl p-4 dark:bg-[#1C1A16] dark:border-[#2C2A24]">
      <div className="text-[11px] font-bold uppercase tracking-widest text-ink-muted mb-2 dark:text-[#C8C2B8]">
        📧 Emails dédiés
      </div>
      <p className="text-[10px] text-ink-muted mb-3 italic dark:text-[#C8C2B8]">
        Si vide, on retombe sur l&apos;email principal {org.email}.
      </p>
      <div className="space-y-2">
        <EmailField label="Factures" value={factures} onChange={setFactures} placeholder={`p.ex. factures@${org.email.split('@')[1] ?? 'foxo.be'}`} cls={inputCls} />
        <EmailField label="Rapports" value={rapports} onChange={setRapports} placeholder={`p.ex. rapports@${org.email.split('@')[1] ?? 'foxo.be'}`} cls={inputCls} />
        <EmailField label="Communications" value={communications} onChange={setCommunications} placeholder={`p.ex. info@${org.email.split('@')[1] ?? 'foxo.be'}`} cls={inputCls} />
      </div>
      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="text-[12px] bg-navy text-white px-3 py-1.5 rounded font-bold disabled:opacity-50"
        >
          {saving ? '…' : '💾 Sauvegarder'}
        </button>
      </div>
    </div>
  );
}

function EmailField({
  label, value, onChange, placeholder, cls,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  cls: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider text-ink-muted mb-1 block dark:text-[#C8C2B8]">
        {label}
      </label>
      <input
        type="email"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cls}
      />
    </div>
  );
}
