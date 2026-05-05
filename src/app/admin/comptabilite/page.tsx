import { redirect } from 'next/navigation';

// Redirige vers la liste factures pour préserver les liens existants
// (factures envoyées, signets admin, etc.) tout en exposant le nouveau
// nom métier "Comptabilité" dans la sidebar.
export default function ComptabilitePage() {
  redirect('/admin/facturation');
}
