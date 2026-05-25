import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * isAdminUser — primitive de lecture côté serveur.
 *
 * Répond à : "l'utilisateur de la session courante est-il admin ?"
 * en consultant la table `utilisateurs` (source de vérité), cohérent
 * avec la fonction SQL public.is_admin() basculée en étape 2.A du
 * chantier refacto is_admin().
 *
 * - Retourne false si non connecté, erreur de lecture, ou role != 'admin'.
 * - Ne lance jamais d'exception : le code appelant décide quoi faire.
 * - Utilise le client SSR pour récupérer auth.uid() (cookies),
 *   puis le client admin (service-role) pour lire utilisateurs.role
 *   afin d'éviter toute dépendance RLS récursive.
 *
 * Cette fonction sera consommée par assertAdmin() (sous-étape 3.2) et
 * remplace progressivement les checks inline `roleForEmail(...) !== 'admin'`.
 */
export async function isAdminUser(): Promise<boolean> {
  try {
    const supabaseSSR = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabaseSSR.auth.getUser();

    if (userError || !user) {
      return false;
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("utilisateurs")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error || !data) {
      return false;
    }

    return data.role === "admin";
  } catch {
    return false;
  }
}

/**
 * Role applicatif utilisé par la couche routage (proxy, layouts, redirections).
 * Le mapping depuis utilisateurs.role est :
 *   'admin'      → 'admin'
 *   'technicien' → 'tech'
 *   tout autre, ou pas de row dans utilisateurs (cas partenaire syndic/courtier
 *   qui vit dans `delegues`)
 *                → 'partner'
 */
export type Role = "admin" | "tech" | "partner";

/**
 * roleForUser — équivalent DB-backed de roleForEmail() pour la couche routage.
 *
 * Répond à : "quel est le rôle applicatif de l'utilisateur de la session courante ?"
 * en consultant utilisateurs.role (source de vérité, alignée avec public.is_admin()).
 *
 * - Retourne 'partner' (défaut sûr) si non connecté, erreur de lecture, ou
 *   aucune row utilisateurs (cas des partenaires qui vivent dans `delegues`).
 * - Ne lance jamais d'exception.
 * - Utilise le client SSR pour récupérer auth.uid() (cookies), puis le client
 *   admin (service-role) pour lire utilisateurs.role.
 *
 * Cette fonction remplace progressivement roleForEmail() dans la couche routage
 * (proxy, page d'accueil, redirect post-OTP, layouts) — voir sous-étape 3.4b.
 * roleForEmail reste consommée pour le check 'tech' via TECH_EMAILS, hors scope
 * du chantier is_admin().
 *
 * Note de perf : 1 round-trip DB par appel. Acceptable au regard du trafic
 * actuel de FoxO. Un futur chantier pourra basculer sur un JWT claim
 * (app_metadata.role peuplé par un hook Supabase) si la latence le justifie.
 */
export async function roleForUser(): Promise<Role> {
  try {
    const supabaseSSR = await createServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabaseSSR.auth.getUser();

    if (userError || !user) {
      return "partner";
    }

    return roleForUserId(user.id);
  } catch {
    return "partner";
  }
}

/**
 * roleForUserId — variante de roleForUser() qui prend un userId déjà connu.
 *
 * Utilise UNIQUEMENT createAdminClient (pas de next/headers), donc compatible
 * middleware/proxy où cookies() de next/headers n'est pas disponible.
 *
 * Le proxy (src/proxy.ts) construit son propre client Supabase via les
 * request.cookies du middleware, en extrait user.id, puis appelle ce helper.
 *
 * - Retourne 'partner' (défaut sûr) si erreur, ou rôle non reconnu.
 * - Ne lance jamais d'exception.
 * - Logge explicitement les erreurs de création du client admin : un échec
 *   silencieux sur cette voie verrouillerait l'admin sans laisser de trace.
 *
 * Source de vérité : utilisateurs.role (aligné avec public.is_admin() SQL).
 */
export async function roleForUserId(userId: string): Promise<Role> {
  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    // SUPABASE_SERVICE_ROLE_KEY absent ou createAdminClient en échec.
    // Loggé explicitement parce qu'un silence ici = lockout admin en prod.
    console.error("[roleForUserId] createAdminClient failed:", err);
    return "partner";
  }

  try {
    const { data, error } = await admin
      .from("utilisateurs")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error || !data) {
      return "partner";
    }

    if (data.role === "admin") return "admin";
    if (data.role === "technicien") return "tech";
    return "partner";
  } catch {
    return "partner";
  }
}
