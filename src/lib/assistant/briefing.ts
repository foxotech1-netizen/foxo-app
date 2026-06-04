// Briefing quotidien du Tableau de bord admin — texte généré par Claude à
// partir du contexte FoxO temps réel (buildGlobalContext).
//
// Cache : `unstable_cache` (Data Cache persistant), revalidé toutes les
// heures. Le briefing est GLOBAL (identique pour tous les admins), donc une
// seule génération par heure couvre tous les rendus du Dashboard — l'appel
// Claude + le log d'observabilité ne se produisent qu'au cache-miss.
//
// ⚠ Contrainte Next 16 : un scope `unstable_cache` ne peut pas lire
// `cookies()`. On lit donc les données via le client admin (service role)
// plutôt que le client cookie-bound. Légitime : la page /admin est déjà
// gardée par isAdminUser et le briefing porte sur le pipeline global.

import { unstable_cache } from 'next/cache';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildGlobalContext } from '@/lib/assistant/context';
import { runAgent } from '@/lib/observability';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const REVALIDATE_SECONDS = 3600; // 1 h

const SYSTEM = [
  "Tu es l'assistant interne de FoxO (Fox Group SRL — détection de fuites en Belgique).",
  "Tu rédiges le BRIEFING DU JOUR affiché en tête du tableau de bord admin.",
  '',
  'Règles :',
  '- Réponds en français, tutoiement, ton professionnel et direct (« Tu as… »).',
  "- 3 à 5 phrases maximum, en prose continue (pas de titre, pas de listes à puces).",
  "- Synthétise ce qui mérite l'attention AUJOURD'HUI : urgences, retards, dossiers en suspens, programme du jour.",
  "- Référence des éléments concrets du contexte (refs d'interventions, noms de syndics/ACP) quand c'est utile.",
  "- N'INVENTE RIEN : pas de chiffres, factures, météo ou faits absents du contexte. Si une catégorie est vide, ne la mentionne pas.",
  "- Termine par l'action prioritaire suggérée si elle est évidente.",
].join('\n');

/**
 * Génère le briefing. Lève en cas d'échec (clé API absente, erreur Anthropic)
 * pour que `unstable_cache` ne mette PAS en cache un résultat vide — la
 * prochaine requête réessaiera plutôt que d'afficher un trou pendant 1 h.
 */
async function generateBriefing(): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée');

  const contextBlock = await buildGlobalContext(createAdminClient());
  const system = `${SYSTEM}\n\n── DONNÉES À TA DISPOSITION ──\n${contextBlock}`;

  const { output } = await runAgent<string>({
    agentName: 'briefing',
    agentKind: 'utility',
    model: MODEL,
    inputSummary: { kind: 'briefing', context_chars: contextBlock.length },
    run: async () => {
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: 'Rédige le briefing du jour.' }],
      });
      const block = msg.content[0];
      const text = block && block.type === 'text' ? block.text.trim() : '';
      if (!text) throw new Error('Réponse Anthropic vide');
      return {
        message: msg,
        output: text,
        outputSummary: { raw_chars: text.length },
      };
    },
  });

  return output;
}

const getCachedBriefing = unstable_cache(
  generateBriefing,
  ['admin-briefing'],
  { revalidate: REVALIDATE_SECONDS, tags: ['admin-briefing'] },
);

/**
 * Texte du briefing du jour, mis en cache 1 h. Renvoie `null` en cas
 * d'échec (clé manquante, erreur API) — l'appelant masque alors la carte
 * Briefing plutôt que d'afficher une erreur.
 */
export async function getBriefing(): Promise<string | null> {
  try {
    return await getCachedBriefing();
  } catch (e) {
    console.warn('[assistant/briefing] génération échouée:', e instanceof Error ? e.message : e);
    return null;
  }
}
