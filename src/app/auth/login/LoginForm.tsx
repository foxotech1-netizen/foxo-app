'use client';

import { useActionState, useEffect, useRef } from 'react';
import { sendOtp, verifyOtp, type AuthState } from './actions';

const initialState: AuthState = {};

export function LoginForm() {
  const [sendState, sendAction, sending] = useActionState(sendOtp, initialState);
  const [verifyState, verifyAction, verifying] = useActionState(verifyOtp, initialState);

  const otpRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sendState.sentTo) otpRef.current?.focus();
  }, [sendState.sentTo]);

  const sentTo = verifyState.sentTo ?? sendState.sentTo;
  const showOtp = Boolean(sentTo);

  if (showOtp) {
    return (
      <form action={verifyAction} className="text-center">
        <input type="hidden" name="email" value={sentTo} />
        <div className="text-3xl mb-2">✉️</div>
        <h2 className="text-[15px] font-bold text-navy mb-1.5">Code envoyé</h2>
        <p className="text-xs text-ink-mid leading-relaxed mb-4">
          Entre le code à 6 chiffres reçu à<br />
          <strong className="text-ink font-mono">{sentTo}</strong>
        </p>
        <input
          ref={otpRef}
          name="token"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          placeholder="••••••"
          className="w-full px-4 py-3.5 border border-sand-border focus:border-navy-mid rounded-lg text-[22px] tracking-[.5em] text-center font-mono font-bold bg-white text-ink outline-none mb-2.5"
        />
        {verifyState.error && (
          <div className="text-xs text-terra bg-terra-light border border-terra-mid px-3 py-2 rounded-md mb-2 font-semibold">
            {verifyState.error}
          </div>
        )}
        <button
          type="submit"
          disabled={verifying}
          className="w-full bg-navy text-white py-3.5 rounded-lg font-bold tracking-wider hover:bg-navy-mid disabled:opacity-50"
        >
          {verifying ? 'Vérification…' : 'Se connecter'}
        </button>
        <button
          type="button"
          onClick={() => { window.location.href = '/auth/login'; }}
          className="mt-2.5 w-full bg-sand-mid text-ink-mid py-2.5 rounded-lg text-xs font-semibold hover:bg-sand-border"
        >
          ← Utiliser une autre adresse
        </button>
        <p className="text-[11px] text-ink-muted mt-2.5">Le code expire dans 1 heure.</p>
      </form>
    );
  }

  return (
    <form action={sendAction}>
      <label className="text-xs text-ink-mid font-semibold block mb-1.5">
        Adresse email
      </label>
      <input
        ref={emailRef}
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="vous@exemple.be"
        className="w-full px-3.5 py-3 border border-sand-border focus:border-navy-mid rounded-lg bg-white text-ink outline-none mb-3"
      />
      {sendState.error && (
        <div className="text-xs text-terra bg-terra-light border border-terra-mid px-3 py-2 rounded-md mb-2 font-semibold">
          {sendState.error}
        </div>
      )}
      <button
        type="submit"
        disabled={sending}
        className="w-full bg-navy text-white py-3.5 rounded-lg font-bold tracking-wider hover:bg-navy-mid disabled:opacity-50"
      >
        {sending ? 'Envoi…' : 'Recevoir le code'}
      </button>
      <p className="text-[11px] text-ink-muted text-center mt-3">
        Un code à 6 chiffres sera envoyé à votre adresse email
      </p>
    </form>
  );
}
