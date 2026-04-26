'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { respondAsOccupant, type Reponse } from '../actions';

export function ConfirmActions({
  occupantId,
  currentConf,
}: {
  occupantId: string;
  currentConf: 'confirme' | 'en_attente' | 'decline';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function send(reponse: Reponse) {
    setError(null);
    startTransition(async () => {
      const res = await respondAsOccupant(occupantId, reponse);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => send('confirme')}
          disabled={pending || currentConf === 'confirme'}
          className="bg-ok text-white py-3.5 rounded-xl font-bold text-[14px] disabled:opacity-50 active:opacity-80"
        >
          {currentConf === 'confirme' ? '✓ Confirmé' : 'Je serai présent'}
        </button>
        <button
          onClick={() => send('decline')}
          disabled={pending || currentConf === 'decline'}
          className="bg-terra text-white py-3.5 rounded-xl font-bold text-[14px] disabled:opacity-50 active:opacity-80"
        >
          {currentConf === 'decline' ? '✗ Décliné' : 'Je décline'}
        </button>
      </div>
      {pending && (
        <p className="text-[11px] text-ink-muted text-center mt-2">Enregistrement…</p>
      )}
      {error && (
        <div className="text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2 mt-2">
          {error}
        </div>
      )}
    </div>
  );
}
