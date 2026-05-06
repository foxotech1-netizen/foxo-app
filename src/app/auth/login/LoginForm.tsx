'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Mail } from 'lucide-react';
import { sendOtp, verifyOtp, type AuthState } from './actions';

const initialState: AuthState = {};

// Couleurs spécifiques à l'écran de login (carte sur fond #E2C9A1).
// Inputs en sombre, texte cream — fort contraste, palette charte FoxO.
const C = {
  inputBg: '#2C2A24',
  inputText: '#F0ECE4',
  inputBorder: 'rgba(255,255,255,0.1)',
  label: '#5A4A30',         // libellés des champs (brun foncé sur gold)
  hint: '#8A8278',          // texte d'aide
  errorBg: '#F7EDE5',
  errorBorder: '#E8C4AF',
  errorText: '#C4622D',
};

const inputStyle = {
  background: C.inputBg,
  color: C.inputText,
  border: `1px solid ${C.inputBorder}`,
};

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
        <div className="flex justify-center mb-2">
          <Mail size={32} style={{ color: '#1B3A6B' }} />
        </div>
        <h2 className="text-[15px] font-bold mb-1.5" style={{ color: '#1B3A6B' }}>
          Code envoyé
        </h2>
        <p className="text-xs leading-relaxed mb-4" style={{ color: C.label }}>
          Entre le code à 6 chiffres reçu à<br />
          <strong className="font-mono" style={{ color: '#1C1A16' }}>{sentTo}</strong>
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
          className="w-full px-4 py-3.5 rounded-lg text-[22px] tracking-[.5em] text-center font-mono font-bold outline-none mb-2.5"
          style={inputStyle}
        />
        {verifyState.error && (
          <div
            className="text-xs px-3 py-2 rounded-md mb-2 font-semibold border"
            style={{ background: C.errorBg, borderColor: C.errorBorder, color: C.errorText }}
          >
            {verifyState.error}
          </div>
        )}
        <button
          type="submit"
          disabled={verifying}
          className="w-full bg-navy text-white py-3.5 rounded-lg font-bold tracking-wider hover:bg-navy-mid disabled:opacity-50 transition-colors"
        >
          {verifying ? 'Vérification…' : 'Se connecter'}
        </button>
        <button
          type="button"
          onClick={() => { window.location.href = '/auth/login'; }}
          className="mt-2.5 w-full py-2.5 rounded-lg text-xs font-semibold bg-transparent hover:bg-black/5 transition-colors border"
          style={{ color: C.label, borderColor: 'rgba(0,0,0,0.15)' }}
        >
          ← Utiliser une autre adresse
        </button>
        <p className="text-[11px] mt-2.5" style={{ color: C.hint }}>
          Le code expire dans 1 heure.
        </p>
      </form>
    );
  }

  return (
    <form action={sendAction}>
      <label className="text-xs font-semibold block mb-1.5" style={{ color: C.label }}>
        Adresse email
      </label>
      <input
        ref={emailRef}
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="vous@exemple.be"
        className="w-full px-3.5 py-3 rounded-lg outline-none mb-3"
        style={inputStyle}
      />
      {sendState.error && (
        <div
          className="text-xs px-3 py-2 rounded-md mb-2 font-semibold border"
          style={{ background: C.errorBg, borderColor: C.errorBorder, color: C.errorText }}
        >
          {sendState.error}
        </div>
      )}
      <button
        type="submit"
        disabled={sending}
        className="w-full bg-navy text-white py-3.5 rounded-lg font-bold tracking-wider hover:bg-navy-mid disabled:opacity-50 transition-colors"
      >
        {sending ? 'Envoi…' : 'Recevoir le code'}
      </button>
      <p className="text-[11px] text-center mt-3" style={{ color: C.hint }}>
        Un code à 6 chiffres sera envoyé à votre adresse email
      </p>
    </form>
  );
}
