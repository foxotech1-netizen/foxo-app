'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { respondAsOccupant, type RespondPayload } from '../actions';

type Mode = 'idle' | 'decline' | 'counter';

// Convertit une valeur d'<input type="datetime-local"> (ex. "2026-05-30T14:30")
// en ISO 8601 UTC, robuste au navigateur (locale machine de l'utilisateur).
function localToIso(value: string): string {
  return new Date(value).toISOString();
}

// Pour défaut "fin = début + 1h" sur input datetime-local (sans tz, format
// "YYYY-MM-DDTHH:MM"). Préserve le fuseau de la machine.
function plusOneHour(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  d.setHours(d.getHours() + 1);
  // Reconstruit le format "YYYY-MM-DDTHH:MM" (heure locale).
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ConfirmActions({
  token,
  currentConf,
}: {
  token: string;
  currentConf: 'confirme' | 'en_attente' | 'decline';
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);

  // États formulaire
  const [declineNote, setDeclineNote] = useState('');
  const [counterDebut, setCounterDebut] = useState('');
  const [counterFin, setCounterFin] = useState('');
  const [counterNote, setCounterNote] = useState('');

  function resetAll() {
    setMode('idle');
    setError(null);
    setDeclineNote('');
    setCounterDebut('');
    setCounterFin('');
    setCounterNote('');
  }

  function send(payload: RespondPayload) {
    setError(null);
    startTransition(async () => {
      const res = await respondAsOccupant(token, payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      resetAll();
      router.refresh();
    });
  }

  function submitConfirme() {
    send({ reponse: 'confirme' });
  }

  function submitDecline() {
    send({
      reponse: 'decline',
      note: declineNote.trim() || undefined,
    });
  }

  function submitCounter() {
    if (!counterDebut || !counterFin) {
      setError('Veuillez indiquer un début et une fin.');
      return;
    }
    const tDebut = new Date(counterDebut).getTime();
    const tFin = new Date(counterFin).getTime();
    if (Number.isNaN(tDebut) || Number.isNaN(tFin)) {
      setError('Dates invalides.');
      return;
    }
    if (tDebut <= Date.now()) {
      setError('Le début doit être dans le futur.');
      return;
    }
    if (tFin <= tDebut) {
      setError('La fin doit être postérieure au début.');
      return;
    }
    send({
      reponse: 'counter',
      proposed_debut: localToIso(counterDebut),
      proposed_fin: localToIso(counterFin),
      note: counterNote.trim() || undefined,
    });
  }

  // Vue idle — 3 boutons empilés
  if (mode === 'idle') {
    return (
      <div>
        <div className="flex flex-col gap-2.5">
          <button
            onClick={submitConfirme}
            disabled={pending || currentConf === 'confirme'}
            className="bg-ok text-white py-3.5 rounded-xl font-bold text-[14px] disabled:opacity-50 active:opacity-80"
          >
            {currentConf === 'confirme' ? '✓ Confirmé' : '✅ Je serai présent'}
          </button>
          <button
            onClick={() => { setError(null); setMode('decline'); }}
            disabled={pending}
            className="bg-terra text-white py-3.5 rounded-xl font-bold text-[14px] disabled:opacity-50 active:opacity-80"
          >
            ❌ Je ne peux pas
          </button>
          <button
            onClick={() => { setError(null); setMode('counter'); }}
            disabled={pending}
            className="bg-navy text-white py-3.5 rounded-xl font-bold text-[14px] disabled:opacity-50 active:opacity-80"
          >
            🔄 Proposer un autre créneau
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

  // Vue decline — textarea + envoi
  if (mode === 'decline') {
    return (
      <div className="bg-sand-mid border border-sand-border rounded-xl p-3.5 space-y-2.5">
        <div className="text-[12px] font-bold text-ink">❌ Vous ne pourrez pas être présent</div>
        <label className="block">
          <span className="text-[10px] text-ink-muted uppercase tracking-wider font-bold">
            Raison (optionnelle)
          </span>
          <textarea
            value={declineNote}
            onChange={(e) => setDeclineNote(e.target.value.slice(0, 500))}
            disabled={pending}
            rows={3}
            placeholder="Ex. absent ce jour-là, en télétravail, etc."
            className="mt-1 w-full text-[13px] rounded-lg border border-sand-border bg-cream px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy/30"
          />
          <span className="text-[10px] text-ink-muted block text-right mt-0.5">
            {declineNote.length}/500
          </span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={resetAll}
            disabled={pending}
            className="flex-1 bg-cream border border-sand-border text-ink-mid py-2.5 rounded-xl font-bold text-[13px] disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submitDecline}
            disabled={pending}
            className="flex-1 bg-terra text-white py-2.5 rounded-xl font-bold text-[13px] disabled:opacity-50"
          >
            {pending ? 'Envoi…' : 'Envoyer ma réponse'}
          </button>
        </div>
        {error && (
          <div className="text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    );
  }

  // Vue counter — datetime-local x2 + textarea + envoi
  return (
    <div className="bg-sand-mid border border-sand-border rounded-xl p-3.5 space-y-2.5">
      <div className="text-[12px] font-bold text-ink">🔄 Proposer un autre créneau</div>

      <label className="block">
        <span className="text-[10px] text-ink-muted uppercase tracking-wider font-bold">
          Début
        </span>
        <input
          type="datetime-local"
          value={counterDebut}
          onChange={(e) => {
            const v = e.target.value;
            setCounterDebut(v);
            // Auto-remplit la fin = début + 1h dès que l'utilisateur saisit le début
            // (sauf si une fin a déjà été modifiée manuellement et est postérieure).
            if (v && (!counterFin || new Date(counterFin) <= new Date(v))) {
              setCounterFin(plusOneHour(v));
            }
          }}
          required
          disabled={pending}
          className="mt-1 w-full text-[13px] rounded-lg border border-sand-border bg-cream px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy/30"
        />
      </label>

      <label className="block">
        <span className="text-[10px] text-ink-muted uppercase tracking-wider font-bold">
          Fin
        </span>
        <input
          type="datetime-local"
          value={counterFin}
          onChange={(e) => setCounterFin(e.target.value)}
          required
          disabled={pending}
          className="mt-1 w-full text-[13px] rounded-lg border border-sand-border bg-cream px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy/30"
        />
      </label>

      <label className="block">
        <span className="text-[10px] text-ink-muted uppercase tracking-wider font-bold">
          Commentaire (optionnel)
        </span>
        <textarea
          value={counterNote}
          onChange={(e) => setCounterNote(e.target.value.slice(0, 500))}
          disabled={pending}
          rows={3}
          placeholder="Ex. je suis disponible toute la matinée…"
          className="mt-1 w-full text-[13px] rounded-lg border border-sand-border bg-cream px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy/30"
        />
        <span className="text-[10px] text-ink-muted block text-right mt-0.5">
          {counterNote.length}/500
        </span>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={resetAll}
          disabled={pending}
          className="flex-1 bg-cream border border-sand-border text-ink-mid py-2.5 rounded-xl font-bold text-[13px] disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={submitCounter}
          disabled={pending}
          className="flex-1 bg-navy text-white py-2.5 rounded-xl font-bold text-[13px] disabled:opacity-50"
        >
          {pending ? 'Envoi…' : 'Envoyer ma proposition'}
        </button>
      </div>
      {error && (
        <div className="text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
