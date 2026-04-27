import { ComingSoon } from '@/components/ComingSoon';

export default function ParametresPage() {
  return (
    <ComingSoon
      title="Paramètres"
      subtitle="Configuration de la plateforme"
      icon="⊙"
      description="Paramétrage de Fox Group SRL et de l'app : coordonnées vendeur sur les factures, taux TVA par défaut, conditions de paiement, gestion des techniciens."
      features={[
        'Coordonnées légales (BCE, TVA, IBAN, adresse)',
        'Taux TVA par défaut + délai de paiement',
        'Gestion des techniciens (ajout, suspension, accès PWA)',
        'Templates de rapports + emails',
        'Connexions tierces : Google Calendar, Drive, Resend',
        'Whitelists d\'admins',
      ]}
    />
  );
}
