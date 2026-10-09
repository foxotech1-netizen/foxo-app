'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import QRCode from 'qrcode';
import { VENDOR } from '@/lib/constants/vendor';
import { buildEpcPayloadString } from '@/lib/facturation/epc-qr';

// Coordonnées bancaires : source unique VENDOR (src/lib/constants/vendor.ts).
// Le payload est construit par le MÊME constructeur que les QR des factures
// PDF (buildEpcPayloadString) : un seul format EPC dans toute la plateforme.
// Avant : BIC d'une autre banque écrit en dur ici, et numéro de facture placé
// dans les champs « Purpose » / « référence structurée » du QR.
const IBAN_RAW = VENDOR.iban.replace(/\s+/g, '');

function buildEpcPayload(montantTTC: number, communication: string): string {
  return buildEpcPayloadString({
    beneficiaryName: VENDOR.name,
    iban: VENDOR.iban,
    bic: VENDOR.bic,
    amountEur: montantTTC,
    // Numéro de facture en communication libre (pas une référence structurée).
    textCommunication: communication,
  });
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
    // Montant nul, négatif ou illisible : aucun QR (le constructeur partagé
    // le forcerait à 0,01 € — un QR ne doit jamais demander un autre montant
    // que celui affiché).
    if (!(montantTTC > 0)) return;
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

      {!(montantTTC > 0) ? (
        <div className="w-[200px] rounded-lg border border-sand-border bg-sand-light px-3 py-6 text-center text-[12px] text-ink-mid">
          Aucun montant à payer : pas de QR de paiement.
        </div>
      ) : dataUrl ? (
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

      {montantTTC > 0 && (
        <div className="text-[11px] text-ink-mid text-center max-w-[260px]">
          Scannez avec votre app bancaire pour générer un virement pré-rempli.
        </div>
      )}

      <div className="flex flex-col gap-1.5 items-center text-[11px] font-mono text-ink-mid">
        <div>{VENDOR.iban}</div>
        <div>BIC : {VENDOR.bic}</div>
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
      </div>
    </div>
  );
}
