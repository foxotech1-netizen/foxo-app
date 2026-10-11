import { redirect } from 'next/navigation';

// L'ancien « Import Odoo » par fichier CSV écrivait dans les factures FoxO.
// Il est remplacé par l'onglet « Odoo » : un miroir en lecture seule, rangé à
// part (cf. src/lib/facturation/odoo-sync.ts). Redirection conservée pour les
// signets existants.
export default function ImportOdooPage() {
  redirect('/admin/facturation/odoo');
}
