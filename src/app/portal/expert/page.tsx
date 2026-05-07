import { redirect } from 'next/navigation';

// Route alias /portal/expert — redirige vers /portal qui auto-détecte
// l'orgType de l'utilisateur connecté (cf. Stratégie A : portail unique
// auto-adaptatif). Permet aux tuiles app-hub d'avoir des URLs porteuses
// d'intention sans dupliquer le code du portail.
export const dynamic = 'force-dynamic';

export default function Page() {
  redirect('/portal');
}
