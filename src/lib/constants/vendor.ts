export const VENDOR = {
  name: 'Fox Group SRL',
  addressLine1: 'Stationstraat 55',
  addressLine2: '3070 Kortenberg',
  country: 'Belgique',
  bce: 'BE1030.109.019',
  vat: 'BE1030.109.019',
  iban: 'BE62 9502 6652 9861',
  bank: 'BEOBANK',
  email: 'info@foxo.be',
  phone: '+32 488 700 007',
  website: 'www.foxo.be',
  PAYMENT_TERMS_DAYS: 30,
  DEFAULT_VAT_RATE: 21,
}

export const VENDOR_BILLING_FROM = 'FoxO <facturation@send.foxo.be>'

export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'FoxO <noreply@send.foxo.be>'

// Domaine d'envoi transactionnel de la plateforme (Resend). Tous les mails
// émis par FoxO lui-même (noreply@, facturation@…) portent ce domaine en
// From — sert à les exclure des compteurs « à traiter » et de la liste
// par défaut de la boîte mail admin.
export const PLATFORM_MAIL_DOMAIN = 'send.foxo.be'