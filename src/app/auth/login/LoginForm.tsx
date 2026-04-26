'use client';

import { useActionState, useEffect, useRef } from 'react';
import { sendOtp, verifyOtp, type AuthState } from './actions';

const initialState: AuthState = {};

export function LoginForm() {
  const [sendState, sendAction, sending] = useActionState(sendOtp, initialState);
  const [verifyState, verifyAction, verifying] = useActionState(verifyOtp, initialState);

  const otpRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Une fois le code envoyé, on focus sur l'input OTP
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
        <h2 className="text-[15px] font-bold text-[var(--color-sky-foxo)] mb-1.5">
          Code envoyé
        </h2>
        <p className="text-xs text-[#8AAAC0] leading-relaxed mb-4">
          Entre le code à 6 chiffres reçu à<br />
          <strong className="text-[#F0ECE4]">{sentTo}</strong>
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
          className="w-full px-4 py-3.5 border border-[#1B3A6B] rounded-lg text-[22px] tracking-[.5em] text-center font-mono font-bold bg-[#152D54] text-[#F0ECE4] outline-none mb-2.5"
        />
        {verifyState.error && (
          <div className="text-xs text-[#C4622D] bg-[#F7EDE5] px-3 py-2 rounded-md mb-2">
            {verifyState.error}
          </div>
        )}
        <button
          type="submit"
          disabled={verifying}
          className="w-full bg-[#1B3A6B] text-white py-3.5 rounded-lg font-bold tracking-wider disabled:opacity-50"
        >
          {verifying ? 'Vérification…' : 'Se connecter'}
        </button>
        <button
          type="button"
          formAction={() => {
            // Retour à l'étape email — recharge la page pour reset les states
            window.location.href = '/auth/login';
          }}
          className="mt-2.5 w-full border border-[#1B3A6B] text-[#5A7494] py-2.5 rounded-lg text-xs"
        >
          ← Utiliser une autre adresse
        </button>
        <p className="text-[11px] text-[#4A6080] mt-2.5">Le code expire dans 1 heure.</p>
      </form>
    );
  }

  return (
    <form action={sendAction}>
      <label className="text-xs text-[#8AAAC0] font-semibold block mb-1.5">
        Adresse email
      </label>
      <input
        ref={emailRef}
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="vous@exemple.be"
        className="w-full px-3.5 py-3 border border-[#1B3A6B] rounded-lg bg-[#152D54] text-[#F0ECE4] outline-none mb-3"
      />
      {sendState.error && (
        <div className="text-xs text-[#C4622D] bg-[#F7EDE5] px-3 py-2 rounded-md mb-2">
          {sendState.error}
        </div>
      )}
      <button
        type="submit"
        disabled={sending}
        className="w-full bg-[#1B3A6B] text-white py-3.5 rounded-lg font-bold tracking-wider disabled:opacity-50"
      >
        {sending ? 'Envoi…' : 'Recevoir le code'}
      </button>
      <p className="text-[11px] text-[#4A6080] text-center mt-3">
        Un code à 6 chiffres sera envoyé à votre adresse email
      </p>
    </form>
  );
}
