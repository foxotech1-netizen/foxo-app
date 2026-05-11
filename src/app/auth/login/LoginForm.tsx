'use client';

// Formulaire login OTP 2 étapes :
//   1. Saisie email → envoie le code à 6 chiffres (sendOtp action)
//   2. Saisie du code → vérifie + connexion (verifyOtp action)
//
// Design system FoxO appliqué — 100% tokens var(--color-*), aucun hex
// hardcodé. Inputs sand + border sand-border, focus navy avec ring
// navy-pale. Bouton primary navy + cream. Compatible mode sombre OS
// car aucun dark: variant Tailwind n'est utilisé (les tokens FoxO
// restent cohérents quel que soit le système).

import { useActionState, useEffect, useRef } from 'react';
import { Mail } from 'lucide-react';
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
        <div className="flex justify-center mb-2">
          <Mail size={32} aria-hidden style={{ color: 'var(--color-navy)' }} />
        </div>
        <h2
          className="font-sora text-[15px] font-semibold mb-1.5"
          style={{ color: 'var(--color-navy)' }}
        >
          Code envoyé
        </h2>
        <p
          className="text-xs leading-relaxed mb-4"
          style={{ color: 'var(--color-ink-mid)' }}
        >
          Entre le code à 6 chiffres reçu à<br />
          <strong className="font-mono" style={{ color: 'var(--color-ink)' }}>
            {sentTo}
          </strong>
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
          className="login-input w-full px-4 py-3.5 rounded-lg text-[22px] tracking-[.5em] text-center font-mono font-bold outline-none mb-2.5 min-h-[48px]"
          style={{
            background: 'var(--color-sand)',
            color: 'var(--color-ink)',
            border: '1px solid var(--color-sand-border)',
          }}
        />
        {verifyState.error && (
          <div
            className="text-xs px-3 py-2 rounded-md mb-2 font-semibold border"
            style={{
              background: 'var(--color-terra-light)',
              borderColor: 'var(--color-terra-mid)',
              color: 'var(--color-terra)',
            }}
          >
            {verifyState.error}
          </div>
        )}
        <button
          type="submit"
          disabled={verifying}
          className="login-btn w-full py-3.5 rounded-lg font-sora font-medium text-[14px] tracking-wider disabled:opacity-50 transition-colors min-h-[48px]"
          style={{
            background: 'var(--color-navy)',
            color: 'var(--color-cream)',
          }}
        >
          {verifying ? 'Vérification…' : 'Se connecter'}
        </button>
        <button
          type="button"
          onClick={() => { window.location.href = '/auth/login'; }}
          className="login-btn-ghost mt-2.5 w-full py-2.5 rounded-lg text-xs font-semibold transition-colors border min-h-[44px]"
          style={{
            color: 'var(--color-ink-mid)',
            borderColor: 'var(--color-sand-border)',
            background: 'transparent',
          }}
        >
          ← Utiliser une autre adresse
        </button>
        <p className="text-[11px] mt-2.5" style={{ color: 'var(--color-ink-muted)' }}>
          Le code expire dans 1 heure.
        </p>

        <LoginFormStyles />
      </form>
    );
  }

  return (
    <form action={sendAction}>
      <label
        className="text-[11px] font-medium uppercase tracking-[0.12em] block mb-1.5"
        style={{ color: 'var(--color-ink-mid)' }}
      >
        Adresse email
      </label>
      <input
        ref={emailRef}
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="vous@exemple.be"
        className="login-input w-full px-3.5 py-3 rounded-lg outline-none mb-3 min-h-[48px] text-[14px]"
        style={{
          background: 'var(--color-sand)',
          color: 'var(--color-ink)',
          border: '1px solid var(--color-sand-border)',
        }}
      />
      {sendState.error && (
        <div
          className="text-xs px-3 py-2 rounded-md mb-2 font-semibold border"
          style={{
            background: 'var(--color-terra-light)',
            borderColor: 'var(--color-terra-mid)',
            color: 'var(--color-terra)',
          }}
        >
          {sendState.error}
        </div>
      )}
      <button
        type="submit"
        disabled={sending}
        className="login-btn w-full py-3.5 rounded-lg font-sora font-medium text-[14px] tracking-wider disabled:opacity-50 transition-colors min-h-[48px]"
        style={{
          background: 'var(--color-navy)',
          color: 'var(--color-cream)',
        }}
      >
        {sending ? 'Envoi…' : 'Recevoir le code'}
      </button>
      <p
        className="text-[11px] text-center mt-3 italic"
        style={{ color: 'var(--color-ink-muted)' }}
      >
        Un code à 6 chiffres sera envoyé à votre adresse email
      </p>

      <LoginFormStyles />
    </form>
  );
}

// Styles focus / hover scopés à .login-input et .login-btn pour rester
// dans le respect du design system (pas de modification globale).
function LoginFormStyles() {
  return (
    <style>{`
      .login-input::placeholder {
        color: var(--color-ink-muted);
        font-style: italic;
      }
      .login-input:focus {
        border-color: var(--color-navy) !important;
        box-shadow: 0 0 0 3px var(--color-navy-pale);
      }
      .login-btn {
        cursor: pointer;
      }
      .login-btn:hover:not(:disabled) {
        background: var(--color-navy-dark) !important;
      }
      .login-btn-ghost:hover:not(:disabled) {
        background: var(--color-sand-hover);
      }
    `}</style>
  );
}
