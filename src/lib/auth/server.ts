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
