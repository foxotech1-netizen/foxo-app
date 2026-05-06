'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Pencil } from 'lucide-react';
import QRCode from 'qrcode';

// Coordonnées Fox Group srl — fixes (cf. footer rapports + IBAN Beobank).
const BIC = 'NICABEBB';
const BENEFICIAIRE = 'Fox Group srl';
const IBAN_RAW = 'BE62950266529861';
const IBAN_DISPLAY = 'BE62 9502 6652 9861';

// Construit le payload EPC SCT (Quick Response Code Guidelines, EPC012-09 v2)
// reconnu par toutes les apps bancaires belges qui supportent le scan QR
// virement européen. Format strict respecté ligne par ligne.
function buildEpcPayload(montantTTC: number, communication: string): string {
  // Montant : EUR + nombre avec point décimal et 2 décimales max.
  const amount = `EUR${(Math.round(montantTTC * 100) / 100).toFixed(2)}`;
  return [
    'BCD',
    '002',
    '1',
    'SCT',
    BIC,
    BENEFICIAIRE,
    IBAN_RAW,
    amount,
    communication,
    communication,
  ].join('\n');
}

function fmtMoney(n: number): string {
  return n.toLocaleString('fr-BE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + ' €';
}

export function QrPaiement({
  factureId,
  numero,
  montantTTC,
}: {
  factureId: string;
  numero: string;
  montantTTC: number;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const payload = buildEpcPayload(montantTTC, numero);
    QRCode.toDataURL(payload, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1B3A5C', light: '#FFFFFF' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Erreur QR.');
      });
    return () => {
      cancelled = true;
    };
  }, [montantTTC, numero]);

  async function copyIban() {
    try {
      await navigator.clipboard.writeText(IBAN_RAW);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copie impossible — sélectionne l\'IBAN à la main.');
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="text-3xl font-extrabold text-navy">{fmtMoney(montantTTC)}</div>
      <div className="text-[11px] font-mono text-ink-muted">{numero}</div>

      {error && (
        <div className="text-xs text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-1.5">
          {error}
        </div>
      )}

      {dataUrl ? (
        <img
          src={dataUrl}
          alt={`QR de paiement EPC pour ${numero}`}
          width={200}
          height={200}
          className="rounded-lg border border-sand-border bg-white p-1"
        />
      ) : (
        <div className="w-[200px] h-[200px] rounded-lg border border-sand-border bg-sand-light animate-pulse" />
      )}

      <div className="text-[11px] text-ink-mid text-center max-w-[260px]">
        Scannez avec votre app bancaire pour générer un virement pré-rempli.
      </div>

      <div className="flex flex-col gap-1.5 items-center text-[11px] font-mono text-ink-mid">
        <div>{IBAN_DISPLAY}</div>
        <div>BIC : {BIC}</div>
      </div>

      <div className="flex flex-col gap-2 w-full max-w-[260px]">
        <button
          type="button"
          onClick={copyIban}
          className="bg-sand-mid text-navy px-3 py-2 rounded-md text-[12px] font-bold hover:bg-sand-border transition inline-flex items-center justify-center gap-1.5"
        >
          {copied ? (
            <><Check size={14} /> IBAN copié</>
          ) : (
            <><Copy size={14} /> Copier IBAN</>
          )}
        </button>
        <a
          href={`/admin/facturation?id=${factureId}`}
          className="text-center text-[11px] text-navy hover:underline font-semibold inline-flex items-center justify-center gap-1.5"
        >
          <Pencil size={12} /> Modifier la facture
        </a>
      </div>
    </div>
  );
}
