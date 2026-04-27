'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveRapport, publishRapport, triggerDriveSync, type RapportInput } from '../../actions';
import type { Rapport } from '@/lib/types/database';

const SECTIONS: { key: keyof RapportInput; label: string; placeholder: string }[] = [
  { key: 'degats',          label: 'Dégâts',         placeholder: 'Description des dégâts visibles, étendue, support touché…' },
  { key: 'inspection',      label: 'Inspection',     placeholder: 'Méthode utilisée (acoustique, traçeur, thermo), points d\'inspection…' },
  { key: 'conclusion',      label: 'Conclusion',     placeholder: 'Origine identifiée de la fuite, certitude, schéma…' },
  { key: 'recommandations', label: 'Recommandations', placeholder: 'Actions à mener, urgence, devis estimatif…' },
];

// Types minimaux pour SpeechRecognition (non inclus dans lib.dom.d.ts)
type SpeechResultEvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};
type SpeechErrorEvent = { error: string; message?: string };
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function RapportPanel({
  interventionId,
  initial,
  canPublish,
  alreadyPublished,
}: {
  interventionId: string;
  initial: Rapport;
  canPublish: boolean;
  alreadyPublished: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<RapportInput>({
    degats: initial.degats ?? '',
    inspection: initial.inspection ?? '',
    conclusion: initial.conclusion ?? '',
    recommandations: initial.recommandations ?? '',
  });
  const [savedAt, setSavedAt] = useState<string | null>(initial.updated_at || null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [activeDictation, setActiveDictation] = useState<keyof RapportInput | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const supportsSpeech = typeof window !== 'undefined' && Boolean(getRecognitionCtor());

  function update(key: keyof RapportInput, val: string) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function startDictation(key: keyof RapportInput) {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setFeedback({ kind: 'err', msg: 'Dictée non supportée par ce navigateur.' });
      return;
    }
    // Stoppe une dictée en cours sur une autre section
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    const rec = new Ctor();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      let added = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) added += r[0].transcript;
      }
      if (added) {
        const cur = valuesRef.current[key] ?? '';
        const sep = cur && !cur.endsWith(' ') && !cur.endsWith('\n') ? ' ' : '';
        update(key, cur + sep + added.trim());
      }
    };
    rec.onerror = (e) => {
      setFeedback({ kind: 'err', msg: `Dictée : ${e.error}` });
      setActiveDictation(null);
    };
    rec.onend = () => setActiveDictation(null);
    recognitionRef.current = rec;
    rec.start();
    setActiveDictation(key);
    setFeedback(null);
  }

  function stopDictation() {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setActiveDictation(null);
  }

  // Auto-save toutes les 30s si modifs
  useEffect(() => {
    const t = setTimeout(() => {
      if (alreadyPublished) return;
      // pas de save si les valeurs n'ont pas changé depuis l'initial
      const changed =
        values.degats !== (initial.degats ?? '') ||
        values.inspection !== (initial.inspection ?? '') ||
        values.conclusion !== (initial.conclusion ?? '') ||
        values.recommandations !== (initial.recommandations ?? '');
      if (!changed) return;
      void doSave(false);
    }, 30_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  function doSave(showFeedback = true) {
    return new Promise<void>((resolve) => {
      startTransition(async () => {
        const res = await saveRapport(interventionId, values);
        if (res.ok) {
          setSavedAt(new Date().toISOString());
          if (showFeedback) setFeedback({ kind: 'ok', msg: 'Brouillon enregistré.' });
        } else {
          setFeedback({ kind: 'err', msg: res.error });
        }
        resolve();
      });
    });
  }

  function doPublish() {
    if (!confirm('Publier le rapport ? Le syndic et les occupants en seront informés.')) return;
    startTransition(async () => {
      const res = await publishRapport(interventionId, values);
      if (res.ok) {
        setFeedback({ kind: 'ok', msg: 'Rapport publié ✓' });
        router.refresh();
      } else {
        setFeedback({ kind: 'err', msg: res.error });
      }
    });
  }

  function doDriveSync() {
    setFeedback(null);
    startTransition(async () => {
      const res = await triggerDriveSync(interventionId);
      if (res.ok) setFeedback({ kind: 'ok', msg: `Synchronisé (${res.uploaded} fichier(s))` });
      else setFeedback({ kind: 'err', msg: res.error });
    });
  }

  return (
    <section className="bg-[#0F2040] border border-navy rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-[#5A7494] uppercase tracking-widest">
          Rapport
        </div>
        {savedAt && (
          <span className="text-[10px] text-[#5A7494] font-mono">
            Enregistré {new Date(savedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {SECTIONS.map(({ key, label, placeholder }) => {
          const isActive = activeDictation === key;
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-bold text-[#A8D4E8]">{label}</label>
                {supportsSpeech && !alreadyPublished && (
                  <button
                    type="button"
                    onClick={() => (isActive ? stopDictation() : startDictation(key))}
                    className={
                      'text-[10px] font-bold px-2 py-1 rounded-md ' +
                      (isActive
                        ? 'bg-terra text-white animate-pulse'
                        : 'bg-[#A17244] text-white hover:bg-[#8A613B]')
                    }
                  >
                    {isActive ? '● Arrêter' : '🎙 Dicter'}
                  </button>
                )}
              </div>
              <textarea
                value={values[key]}
                onChange={(e) => update(key, e.target.value)}
                placeholder={placeholder}
                rows={4}
                disabled={alreadyPublished}
                className="w-full bg-[#152D54] border border-navy rounded-lg px-3 py-2 text-[13px] text-[#F0ECE4] outline-none focus:border-navy-mid resize-y min-h-[80px] disabled:opacity-70"
              />
            </div>
          );
        })}
      </div>

      {feedback && (
        <div
          className={
            'text-[11px] rounded-md px-3 py-2 mt-3 border ' +
            (feedback.kind === 'ok'
              ? 'bg-ok/15 border-ok/40 text-[#8FD0AC]'
              : 'bg-terra-light/10 border-terra/40 text-terra')
          }
        >
          {feedback.msg}
        </div>
      )}

      {!alreadyPublished ? (
        <div className="grid grid-cols-2 gap-2 mt-4">
          <button
            onClick={() => doSave()}
            disabled={pending}
            className="bg-[#A17244] text-white py-3 rounded-xl font-bold text-[13px] hover:bg-[#8A613B] disabled:opacity-50 active:opacity-80"
          >
            {pending ? '…' : 'Enregistrer brouillon'}
          </button>
          <button
            onClick={doPublish}
            disabled={pending || !canPublish}
            title={!canPublish ? 'Clôture l\'intervention avant de publier' : ''}
            className="bg-ok text-white py-3 rounded-xl font-bold text-[13px] disabled:opacity-40 active:opacity-80"
          >
            Publier ✓
          </button>
        </div>
      ) : (
        <div className="bg-ok/15 border border-ok/40 rounded-md px-3 py-2 text-[11px] text-[#8FD0AC] mt-3 text-center">
          ✓ Rapport déjà publié
        </div>
      )}

      <button
        onClick={doDriveSync}
        disabled={pending}
        className="w-full mt-2 bg-[#A17244] text-white py-2.5 rounded-xl text-[12px] font-semibold hover:bg-[#8A613B] disabled:opacity-50"
      >
        ☁ Synchroniser vers Google Drive
      </button>

      {!supportsSpeech && (
        <p className="text-[10px] text-[#5A7494] mt-2 leading-relaxed">
          Dictée vocale indisponible sur ce navigateur. Chrome/Edge sur Android ou Safari iOS recommandé.
        </p>
      )}
    </section>
  );
}
