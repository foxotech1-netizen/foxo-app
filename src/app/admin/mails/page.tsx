import { ComingSoon } from '@/components/ComingSoon';

export default function MailsPage() {
  return (
    <ComingSoon
      title="Mails"
      subtitle="Centre de communication"
      icon="✉"
      description="Tableau de bord des emails entrants et sortants liés aux interventions FoxO. Lecture des demandes par mail, suggestions d'actions générées par Claude API."
      features={[
        'Inbox unifiée (info@foxo.be, contact@foxo.be)',
        'Lecture & extraction automatique des demandes par Claude',
        'Création d\'intervention en 1 clic depuis un email',
        'Historique des mails envoyés (rapports, factures, confirmations occupants)',
        'Templates Resend personnalisables',
      ]}
    />
  );
}
