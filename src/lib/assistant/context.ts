// Construit le contexte FoxO injecté dans le system prompt de l'assistant
// admin (page /admin/assistant et onglet drawer).
//
// Deux modes :
//   - global    : stats globales + listes synthétiques (interventions actives,
//                 syndics actifs, retards, urgentes)
//   - intervention : dossier complet d'une intervention donnée

import { fmtTime, TZ_BRUSSELS } from '@/lib/format';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { searchEmailsByDossier } from '@/lib/gmail';
import type {
  Acp,
  Intervention,
  InterventionRow,
  Occupant,
  Organisation,
  Rapport,
  StatutIntervention,
  Utilisateur,
} from '@/lib/types/database';

// ─── Mode global ─────────────────────────────────────────────────────────

// `client` optionnel : par défaut le client cookie-bound (RLS) utilisé par
// l'Assistant chat. Le briefing du Tableau de bord passe le client admin
// (service role) car il tourne dans un scope `unstable_cache` où `cookies()`
// est interdit — voir src/lib/assistant/briefing.ts.
export async function buildGlobalContext(client?: SupabaseClient): Promise<string> {
  const supabase = client ?? await createClient();
  const now = Date.now();

  const [ivRes, syndicsRes, techsRes] = await Promise.all([
    supabase
      .from('interventions')
      .select('id, ref, type, statut, priorite, creneau_debut, updated_at, date_demande, technicien_id, acp_id, syndic_id, suspens_motif')
      .order('updated_at', { ascending: false })
      .limit(80),
    supabase
      .from('organisations')
      .select('id, nom, type, email, telephone')
      .order('nom', { ascending: true })
      .limit(50),
    supabase
      .from('utilisateurs')
      .select('id, prenom, nom, email')
      .limit(20),
  ]);

  const interventions = (ivRes.data ?? []) as Pick<Intervention,
    'id' | 'ref' | 'type' | 'statut' | 'priorite' | 'creneau_debut' | 'updated_at' | 'date_demande' | 'technicien_id' | 'acp_id' | 'syndic_id' | 'suspens_motif'>[];
  const syndics = (syndicsRes.data ?? []) as Pick<Organisation, 'id' | 'nom' | 'type' | 'email' | 'telephone'>[];
  const techs = (techsRes.data ?? []) as Utilisateur[];

  const acpIds = Array.from(new Set(interventions.map((i) => i.acp_id).filter(Boolean) as string[]));
  const acpRes = acpIds.length
    ? await supabase.from('acps').select('id, nom, ville').in('id', acpIds)
    : { data: [] };
  const acpMap = new Map(((acpRes.data ?? []) as Pick<Acp, 'id' | 'nom' | 'ville'>[]).map((a) => [a.id, a]));
  const techMap = new Map(techs.map((t) => [t.id, t]));
  const syndicMap = new Map(syndics.map((s) => [s.id, s]));

  // Stats par statut
  const byStatus = new Map<StatutIntervention, number>();
  for (const iv of interventions) {
    byStatus.set(iv.statut, (byStatus.get(iv.statut) ?? 0) + 1);
  }

  const enRetard = interventions.filter((iv) => {
    if (iv.statut === 'cloturee' || iv.statut === 'rapport') return false;
    if (!iv.creneau_debut) return false;
    return new Date(iv.creneau_debut).getTime() < now;
  });
  const urgentes = interventions.filter((iv) => iv.priorite === 'urgente' && iv.statut !== 'cloturee');
  const enSuspens = interventions.filter((iv) => iv.statut === 'en_suspens');
  const aujourdhui = interventions.filter((iv) => {
    if (!iv.creneau_debut) return false;
    const d = new Date(iv.creneau_debut);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  });

  const lines: string[] = [];
  lines.push(`## CONTEXTE FOXO (${new Date().toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ_BRUSSELS })})`);
  lines.push('');
  lines.push(`### Statistiques`);
  lines.push(`- Interventions chargées (80 plus récentes) : ${interventions.length}`);
  lines.push(`- Par statut : ${Array.from(byStatus.entries()).map(([s, n]) => `${s}=${n}`).join(', ')}`);
  lines.push(`- Urgentes non clôturées : ${urgentes.length}`);
  lines.push(`- En retard (créneau passé, non clôturé) : ${enRetard.length}`);
  lines.push(`- En suspens : ${enSuspens.length}`);
  lines.push(`- Prévues aujourd'hui : ${aujourdhui.length}`);
  lines.push('');

  if (urgentes.length > 0) {
    lines.push(`### Interventions urgentes`);
    for (const iv of urgentes.slice(0, 10)) {
      lines.push(`- ${iv.ref ?? '?'} · ${iv.type ?? '?'} · ${acpMap.get(iv.acp_id ?? '')?.nom ?? '—'} · ${iv.statut}`);
    }
    lines.push('');
  }

  if (enRetard.length > 0) {
    lines.push(`### Interventions en retard (créneau dépassé)`);
    for (const iv of enRetard.slice(0, 10)) {
      const acp = acpMap.get(iv.acp_id ?? '');
      const tech = iv.technicien_id ? techMap.get(iv.technicien_id) : null;
      lines.push(`- ${iv.ref ?? '?'} · ${iv.type ?? '?'} · ${acp?.nom ?? '—'} · ${iv.statut} · prévu ${new Date(iv.creneau_debut!).toLocaleString('fr-BE', { timeZone: TZ_BRUSSELS })} · tech : ${tech ? `${tech.prenom} ${tech.nom}` : 'non assigné'}`);
    }
    lines.push('');
  }

  if (enSuspens.length > 0) {
    lines.push(`### Interventions en suspens`);
    for (const iv of enSuspens.slice(0, 10)) {
      lines.push(`- ${iv.ref ?? '?'} · ${acpMap.get(iv.acp_id ?? '')?.nom ?? '—'} · motif : ${iv.suspens_motif ?? '—'}`);
    }
    lines.push('');
  }

  if (aujourdhui.length > 0) {
    lines.push(`### Programme du jour`);
    for (const iv of aujourdhui) {
      const tech = iv.technicien_id ? techMap.get(iv.technicien_id) : null;
      const t = fmtTime(iv.creneau_debut!);
      lines.push(`- ${t} · ${iv.ref ?? '?'} · ${acpMap.get(iv.acp_id ?? '')?.nom ?? '—'} · ${iv.type ?? ''} · ${tech ? `${tech.prenom} ${tech.nom}` : 'non assigné'}`);
    }
    lines.push('');
  }

  // Top 10 syndics actifs
  const ivBySyndic = new Map<string, number>();
  for (const iv of interventions) {
    if (iv.syndic_id) ivBySyndic.set(iv.syndic_id, (ivBySyndic.get(iv.syndic_id) ?? 0) + 1);
  }
  const topSyndics = Array.from(ivBySyndic.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topSyndics.length > 0) {
    lines.push(`### Syndics / courtiers actifs`);
    for (const [id, n] of topSyndics) {
      const s = syndicMap.get(id);
      if (!s) continue;
      lines.push(`- ${s.nom} (${s.type}) · ${n} dossier(s) · ${s.email}`);
    }
    lines.push('');
  }

  if (techs.length > 0) {
    lines.push(`### Techniciens`);
    for (const t of techs) {
      lines.push(`- ${t.prenom ?? ''} ${t.nom ?? ''} · ${t.email ?? ''}`.trim());
    }
  }

  return lines.join('\n');
}

// ─── Mode intervention ─────────────────────────────────────────────────────

export async function buildInterventionContext(interventionId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: iv, error: ivError } = await supabase
    .from('interventions')
    .select('*, acp:acps(*), syndic:organisations!syndic_id(*), technicien:utilisateurs(*)')
    .eq('id', interventionId)
    .maybeSingle();
  if (ivError) {
    console.error('[assistant/context] buildInterventionContext: requete intervention en echec', ivError);
    return null;
  }
  if (!iv) return null;

  const ivTyped = iv as InterventionRow;

  const [occRes, rapRes] = await Promise.all([
    supabase.from('occupants').select('*').eq('intervention_id', interventionId),
    supabase.from('rapports').select('*').eq('intervention_id', interventionId).maybeSingle(),
  ]);
  const occupants = (occRes.data ?? []) as Occupant[];
  const rapport = (rapRes.data ?? null) as Rapport | null;

  const lines: string[] = [];
  lines.push(`## DOSSIER ${ivTyped.ref ?? '(sans ref)'}`);
  lines.push('');
  lines.push(`### Identité`);
  lines.push(`- Type : ${ivTyped.type ?? 'non précisé'}`);
  lines.push(`- Priorité : ${ivTyped.priorite}`);
  lines.push(`- Statut : ${ivTyped.statut}`);
  if (ivTyped.suspens_motif) lines.push(`- Motif suspension : ${ivTyped.suspens_motif}`);
  if (ivTyped.creneau_debut) {
    lines.push(`- Créneau : ${new Date(ivTyped.creneau_debut).toLocaleString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ_BRUSSELS })}`);
  }
  if (ivTyped.started_at && ivTyped.ended_at) {
    const a = new Date(ivTyped.started_at);
    const b = new Date(ivTyped.ended_at);
    const min = Math.round((b.getTime() - a.getTime()) / 60000);
    lines.push(`- Durée sur place : ${min} min (${fmtTime(a.toISOString())} → ${fmtTime(b.toISOString())})`);
  }
  lines.push(`- Date demande : ${ivTyped.date_demande ? new Date(ivTyped.date_demande).toLocaleDateString('fr-BE') : '—'}`);
  if (ivTyped.description) lines.push(`- Description initiale : ${ivTyped.description}`);
  lines.push('');

  if (ivTyped.acp) {
    const adresse = [ivTyped.acp.adresse, (ivTyped.acp as Acp).code_postal, ivTyped.acp.ville].filter(Boolean).join(', ');
    lines.push(`### ACP / Lieu`);
    lines.push(`- ${ivTyped.acp.nom}`);
    lines.push(`- ${adresse || '—'}`);
    if ((ivTyped.acp as Acp).bce) lines.push(`- BCE : ${(ivTyped.acp as Acp).bce}`);
    lines.push('');
  } else if (ivTyped.demandeur_type === 'particulier' && ivTyped.particulier_contact) {
    const c = ivTyped.particulier_contact;
    lines.push(`### Particulier`);
    lines.push(`- ${c.prenom} ${c.nom} · ${c.email} · ${c.telephone}`);
    lines.push(`- ${c.adresse.rue}, ${c.adresse.code_postal} ${c.adresse.ville}`);
    lines.push('');
  }

  if (ivTyped.syndic) {
    lines.push(`### ${ivTyped.syndic.type === 'courtier' ? 'Courtier' : 'Syndic'}`);
    lines.push(`- ${ivTyped.syndic.nom} · ${ivTyped.syndic.email}`);
    lines.push('');
  }

  if (ivTyped.technicien) {
    lines.push(`### Technicien assigné`);
    lines.push(`- ${ivTyped.technicien.prenom ?? ''} ${ivTyped.technicien.nom ?? ''}`.trim());
    lines.push('');
  }

  if (occupants.length > 0) {
    lines.push(`### Occupants`);
    for (const o of occupants) {
      const conf = o.conf ?? 'pas de réponse';
      lines.push(`- Apt ${o.appartement ?? '—'} · ${o.nom ?? '—'} · ${o.email ?? '—'} · ${o.telephone ?? '—'} · statut : ${conf}`);
    }
    lines.push('');
  }

  // Emails liés (Gmail) — best-effort, ignoré si Google non connecté
  try {
    const adresseLieu = ivTyped.acp
      ? [ivTyped.acp.adresse, (ivTyped.acp as Acp).code_postal, ivTyped.acp.ville].filter(Boolean).join(', ')
      : (ivTyped.adresse ?? '');
    const acpNom = ivTyped.acp?.nom ?? undefined;
    const syndicEmail = ivTyped.syndic?.email ?? undefined;
    const occupantNom = occupants.find((o) => o.nom)?.nom ?? undefined;
    const emailsRes = await searchEmailsByDossier({
      ref: ivTyped.ref ?? undefined,
      adresse: adresseLieu || undefined,
      acpNom,
      syndicEmail,
      occupantNom,
      limit: 8,
    });
    if (emailsRes.ok && emailsRes.emails.length > 0) {
      lines.push(`### Emails liés (Gmail) — ${emailsRes.emails.length}`);
      for (const m of emailsRes.emails.slice(0, 8)) {
        const dt = m.date ? new Date(m.date).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        lines.push(`- ${dt} · ${m.from} → ${m.subject || '(sans objet)'}`);
        if (m.snippet) lines.push(`  > ${m.snippet.slice(0, 200)}`);
      }
      lines.push('');
    }
  } catch (e) {
    console.warn('[assistant/context] gmail search skipped:', e);
  }

  if (rapport) {
    lines.push(`### Rapport actuel (brouillon)`);
    if (rapport.degats) lines.push(`**Dégâts** : ${rapport.degats}`);
    if (rapport.inspection) lines.push(`**Inspection** : ${rapport.inspection}`);
    if (rapport.conclusion) lines.push(`**Conclusion** : ${rapport.conclusion}`);
    if (rapport.recommandations) lines.push(`**Recommandations** : ${rapport.recommandations}`);
  } else {
    lines.push(`### Rapport`);
    lines.push(`Aucun rapport rédigé pour le moment.`);
  }

  return lines.join('\n');
}
