// Helpers purs pour pré-remplir l'email d'envoi d'un document facturation
// (facture / devis / avoir) et construire le template HTML envoyé.
// Aucun accès DB — toutes les dépendances arrivent en paramètres pour
// pouvoir être appelé depuis un Server Component (page.tsx) ou depuis
// la Server Action sendDocumentEmail.

import type { Facture, TypeFacture } from '@/lib/types/database';

export interface DocumentEmailDefaults {
  to: string;
  subject: string;
  /** Phrase d'accroche pré-remplie dans la modale (« Veuillez trouver
   *  ci-joint… ») — l'utilisateur peut éditer ou effacer avant envoi. */
  intro: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDateBE(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${pad2(d)}/${pad2(m)}/${y}`;
}

function devisValiditeFr(facture: Facture): string {
  if (!facture.date_emission) return '—';
  const days = facture.validite_jours ?? 30;
  const [y, m, d] = facture.date_emission.split('-').map(Number);
  if (!y || !m || !d) return facture.date_emission;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

export function docLabelForType(type: TypeFacture): string {
  switch (type) {
    case 'devis': return 'Devis';
    case 'avoir': return 'Note de crédit';
    default:      return 'Facture';
  }
}

export function filenameForDocument(facture: Facture): string {
  const safeNumero = facture.numero.replace(/[^A-Za-z0-9_-]/g, '_');
  switch (facture.type) {
    case 'devis': return `Devis-${safeNumero}.pdf`;
    case 'avoir': return `Note-credit-${safeNumero}.pdf`;
    default:      return `Facture-${safeNumero}.pdf`;
  }
}

export function buildDocumentEmailDefaults(args: {
  facture: Facture;
  /** email_factures du client (cf. clients.email_factures) — prioritaire */
  clientEmailFactures?: string | null;
  /** Numéro de la facture d'origine (uniquement pertinent pour les avoirs) */
  factureOrigineNumero?: string | null;
}): DocumentEmailDefaults {
  const { facture, clientEmailFactures, factureOrigineNumero } = args;

  // Cascade destinataire : email_factures (client) → client_email (facture)
  const to = (
    clientEmailFactures?.trim()
    || facture.client_email?.trim()
    || ''
  ).toLowerCase();

  let subject: string;
  let intro: string;
  switch (facture.type) {
    case 'devis': {
      const valFr = devisValiditeFr(facture);
      subject = `Devis ${facture.numero} — FoxO (valable jusqu'au ${valFr})`;
      intro = `Veuillez trouver ci-joint votre devis ${facture.numero}, valable jusqu'au ${valFr}.`;
      break;
    }
    case 'avoir': {
      const refSuffix = factureOrigineNumero ? ` (réf. ${factureOrigineNumero})` : '';
      subject = `Note de crédit ${facture.numero} — FoxO${refSuffix}`;
      intro = factureOrigineNumero
        ? `Veuillez trouver ci-joint votre note de crédit ${facture.numero} relative à la facture ${factureOrigineNumero}.`
        : `Veuillez trouver ci-joint votre note de crédit ${facture.numero}.`;
      break;
    }
    default: {
      subject = `Facture ${facture.numero} — FoxO`;
      const echeanceFr = facture.date_echeance ? fmtDateBE(facture.date_echeance) : null;
      intro = echeanceFr
        ? `Veuillez trouver ci-joint votre facture ${facture.numero}, à régler pour le ${echeanceFr}.`
        : `Veuillez trouver ci-joint votre facture ${facture.numero}.`;
    }
  }

  return { to, subject, intro };
}

// ─── Template HTML du mail ───────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}

// Convertit un texte multi-lignes en HTML : escape + remplace les
// retours-ligne par <br>. Préserve les paragraphes (double newline → </p><p>).
function nl2html(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .split(/\r?\n\r?\n/)                              // paragraphes
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

export interface BuildEmailHtmlArgs {
  facture: Facture;
  intro: string;            // pré-rempli, modifiable côté UI
  message?: string;         // message libre additionnel saisi par l'admin
}

export function buildDocumentEmailHtml(args: BuildEmailHtmlArgs): string {
  const { facture, intro, message } = args;
  const docLabel = docLabelForType(facture.type);

  const introHtml = intro.trim().length > 0 ? nl2html(intro.trim()) : '';
  const messageHtml = message && message.trim().length > 0
    ? `<div style="margin-top:14px;padding-top:14px;border-top:1px solid #DDD8CC">${nl2html(message.trim())}</div>`
    : '';

  // Layout table-based pour compat large des clients mail (Outlook…)
  return `<!DOCTYPE html><html><body style="margin:0;background:#F5F2EC;font-family:'DM Sans',Arial,sans-serif;color:#1C1A16">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F2EC;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FDFBF7;border-radius:12px;border:1px solid #DDD8CC;padding:24px">
      <tr><td>
        <div style="font-size:20px;font-weight:800;color:#1B3A6B;letter-spacing:.02em">FoxO</div>
        <div style="font-size:11px;color:#A09A8E;text-transform:uppercase;letter-spacing:.1em;margin-top:2px">${escapeHtml(docLabel)} ${escapeHtml(facture.numero)}</div>
        <div style="height:1px;background:#DDD8CC;margin:16px 0"></div>
        <p style="margin:0 0 12px;font-size:14px">Bonjour${facture.client_nom ? ' ' + escapeHtml(facture.client_nom) : ''},</p>
        <div style="font-size:14px;line-height:1.6;color:#1C1A16">
          ${introHtml}
        </div>
        ${messageHtml}
        <div style="height:1px;background:#DDD8CC;margin:18px 0"></div>
        <p style="font-size:12px;color:#6B6558;line-height:1.5;margin:0">
          Cordialement,<br>
          <strong style="color:#1B3A6B">FoxO</strong> — détection de fuites &amp; inspection caméra<br>
          <a href="https://foxo.be" style="color:#1B3A6B;text-decoration:none">foxo.be</a> · <a href="mailto:info@foxo.be" style="color:#1B3A6B;text-decoration:none">info@foxo.be</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}
