'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveRapport, publishRapport, triggerDriveSync, type RapportInput } from '../../actions';
import { generateRapportSections } from './generate-action';
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

// Photo retournée par /api/tech/photos
interface SectionPhoto {
  id: string;
  drive_url: string;
  filename: string | null;
  section: string | null;
  ordre: number;
  uploaded_at: string | null;
}
type SectionKey = keyof RapportInput;

export function RapportPanel({
  interventionId,
  interventionRef,
  acpNom,
  initial,
  canPublish,
  alreadyPublished,
}: {
  interventionId: string;
  interventionRef?: string | null;
  acpNom?: string | null;
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
  // 'brief' = clé virtuelle pour la dictée brute envoyée à Claude
  const [activeDictation, setActiveDictation] = useState<keyof RapportInput | 'brief' | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Brief / dictée brute envoyée à l'IA pour générer les 4 sections
  const [brief, setBrief] = useState('');
  const briefRef = useRef(brief);
  briefRef.current = brief;
  const [generating, startGenerateTransition] = useTransition();
  const [generateMessage, setGenerateMessage] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // Photos par section (cf. migration 2026-05-28_photos_section).
  // Map<sectionKey, photos[]> — chaque liste triée par ordre asc.
  const [photosBySection, setPhotosBySection] = useState<Record<SectionKey, SectionPhoto[]>>({
    degats: [], inspection: [], conclusion: [], recommandations: [],
  });
  const [uploadingSection, setUploadingSection] = useState<SectionKey | null>(null);

  // Aperçu modal (overlay full screen, pas de PDF — juste rendu HTML
  // formaté avec en-tête FoxO + 4 sections + filigrane BROUILLON).
  const [previewOpen, setPreviewOpen] = useState(false);

  // Export Word : génère le .docx (template FoxO Rapport v3) et l'upload
  // sur Drive. State séparé de `pending` car ne passe pas par useTransition.
  const [exportingWord, setExportingWord] = useState(false);

  // Fetch photos liées au rapport au mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tech/photos?intervention_id=${interventionId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { ok: boolean; photos?: SectionPhoto[] }) => {
        if (cancelled || !d.ok) return;
        const grouped: Record<SectionKey, SectionPhoto[]> = {
          degats: [], inspection: [], conclusion: [], recommandations: [],
        };
        for (const p of d.photos ?? []) {
          if (p.section && p.section in grouped) {
            grouped[p.section as SectionKey].push(p);
          }
        }
        // Tri par ordre asc dans chaque section
        for (const k of Object.keys(grouped) as SectionKey[]) {
          grouped[k].sort((a, b) => a.ordre - b.ordre);
        }
        setPhotosBySection(grouped);
      })
      .catch(() => { /* noop, panel reste vide */ });
    return () => { cancelled = true; };
  }, [interventionId]);

  async function uploadPhotoToSection(section: SectionKey, file: File) {
    setUploadingSection(section);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('intervention_id', interventionId);
      fd.append('section', section);
      const r = await fetch('/api/tech/upload-photo', { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.ok) {
        setFeedback({ kind: 'err', msg: d.error ?? 'Upload échoué.' });
        return;
      }
      // Optimistic : ajoute en bas (max ordre)
      setPhotosBySection((cur) => {
        const list = cur[section];
        const newPhoto: SectionPhoto = {
          id: d.id ?? crypto.randomUUID(),
          drive_url: d.drive_url,
          filename: d.filename ?? null,
          section,
          ordre: list.length,
          uploaded_at: new Date().toISOString(),
        };
        return { ...cur, [section]: [...list, newPhoto] };
      });
    } finally {
      setUploadingSection(null);
    }
  }

  async function patchPhoto(photoId: string, patch: { section?: SectionKey | null; ordre?: number }) {
    try {
      await fetch(`/api/tech/photos/${photoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch { /* noop, optimistic state reste */ }
  }

  // Réordonnage : déplace la photo de delta positions dans sa section,
  // puis persiste les nouveaux ordres pour les 2 photos swappées.
  function movePhoto(section: SectionKey, photoId: string, delta: -1 | 1) {
    setPhotosBySection((cur) => {
      const list = [...cur[section]];
      const idx = list.findIndex((p) => p.id === photoId);
      if (idx < 0) return cur;
      const newIdx = idx + delta;
      if (newIdx < 0 || newIdx >= list.length) return cur;
      [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
      // Re-numérote les ordres et persiste les 2 changés
      list[idx].ordre = idx;
      list[newIdx].ordre = newIdx;
      void patchPhoto(list[idx].id, { ordre: idx });
      void patchPhoto(list[newIdx].id, { ordre: newIdx });
      return { ...cur, [section]: list };
    });
  }

  // Retire la photo de la section (section = null) — la photo reste sur
  // Drive et dans photos_interventions, simplement détachée du rapport.
  function unlinkPhoto(section: SectionKey, photoId: string) {
    setPhotosBySection((cur) => ({
      ...cur,
      [section]: cur[section].filter((p) => p.id !== photoId),
    }));
    void patchPhoto(photoId, { section: null });
  }

  const supportsSpeech = typeof window !== 'undefined' && Boolean(getRecognitionCtor());

  function update(key: keyof RapportInput, val: string) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function startDictation(key: keyof RapportInput | 'brief') {
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
      if (!added) return;
      if (key === 'brief') {
        const cur = briefRef.current ?? '';
        const sep = cur && !cur.endsWith(' ') && !cur.endsWith('\n') ? ' ' : '';
        setBrief(cur + sep + added.trim());
      } else {
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

  function doGenerate() {
    setGenerateMessage(null);
    const trimmed = brief.trim();
    if (trimmed.length < 20) {
      setGenerateMessage({ kind: 'err', msg: 'Brief trop court (min. 20 caractères).' });
      return;
    }
    startGenerateTransition(async () => {
      const res = await generateRapportSections(interventionId, trimmed);
      if (!res.ok) {
        setGenerateMessage({ kind: 'err', msg: res.error });
        return;
      }
      setValues({
        degats: res.sections.degats,
        inspection: res.sections.inspection,
        conclusion: res.sections.conclusion,
        recommandations: res.sections.recommandations,
      });
      setGenerateMessage({ kind: 'ok', msg: 'Sections générées — relis et corrige avant publication.' });
    });
  }

  async function doExportWord() {
    setFeedback(null);
    setExportingWord(true);
    try {
      // 1. Sauvegarde le brouillon courant — sinon on exporterait
      //    l'état persisté en base, pas ce que le tech a tapé depuis.
      if (!alreadyPublished) await doSave(false);
      // 2. Génère + upload sur Drive
      const r = await fetch('/api/tech/rapport-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervention_id: interventionId }),
      });
      const data = (await r.json()) as { ok: boolean; error?: string; web_view_link?: string; file_id?: string };
      if (!data.ok) {
        setFeedback({ kind: 'err', msg: data.error ?? 'Erreur export Word.' });
        return;
      }
      // Force le téléchargement direct du .docx — webViewLink ouvre la
      // visionneuse Drive (qui peut tenter d'afficher le fichier en
      // ligne) ; uc?export=download streame le binaire pour que le
      // navigateur déclenche un téléchargement local du Word éditable.
      if (data.file_id) {
        const downloadUrl = `https://drive.google.com/uc?export=download&id=${data.file_id}`;
        window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      } else if (data.web_view_link) {
        window.open(data.web_view_link, '_blank', 'noopener,noreferrer');
      }
      setFeedback({ kind: 'ok', msg: 'Word généré sur Drive ✓' });
    } catch (e) {
      setFeedback({ kind: 'err', msg: e instanceof Error ? e.message : 'Erreur réseau.' });
    } finally {
      setExportingWord(false);
    }
  }

  function doDriveSync() {
    setFeedback(null);
    startTransition(async () => {
      const res = await triggerDriveSync(interventionId);
      if (res.ok) {
        const parts: string[] = [];
        if (res.rapport_url) parts.push('rapport ✓');
        parts.push(`${res.photos_count} photo${res.photos_count > 1 ? 's' : ''}`);
        setFeedback({ kind: 'ok', msg: `Sync Drive — ${parts.join(', ')}` });
      } else {
        setFeedback({ kind: 'err', msg: res.error });
      }
    });
  }

  return (
    <section className="bg-cream border border-sand-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] font-bold text-ink-muted uppercase tracking-widest">
          Rapport
        </div>
        {savedAt && (
          <span className="text-[10px] text-ink-muted font-mono">
            Enregistré {new Date(savedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {!alreadyPublished && (
        <div className="bg-white border border-sand-border rounded-xl p-3 mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[12px] font-bold text-navy">
              Brief / Dictée pour Claude
            </label>
            {supportsSpeech && (
              <button
                type="button"
                onClick={() =>
                  activeDictation === 'brief' ? stopDictation() : startDictation('brief')
                }
                className={
                  'text-[10px] font-bold px-2 py-1 rounded-md ' +
                  (activeDictation === 'brief'
                    ? 'bg-terra text-white animate-pulse'
                    : 'bg-[#A17244] text-white hover:bg-[#8A613B]')
                }
              >
                {activeDictation === 'brief' ? '● Arrêter' : '🎙 Dicter'}
              </button>
            )}
          </div>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Dicte librement ce que tu as vu, fait, conclu et recommandé. Claude rédigera les 4 sections du rapport."
            rows={5}
            className="w-full bg-white border border-sand-border rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-navy-mid resize-y min-h-[100px]"
          />
          <button
            type="button"
            onClick={doGenerate}
            disabled={generating || pending}
            className="w-full mt-2 bg-navy text-white py-2.5 rounded-xl font-bold text-[13px] hover:opacity-90 disabled:opacity-50"
          >
            {generating ? 'Génération en cours…' : '✨ Générer avec Claude'}
          </button>
          {generateMessage && (
            <div
              className={
                'text-[11px] rounded-md px-3 py-2 mt-2 border font-semibold ' +
                (generateMessage.kind === 'ok'
                  ? 'bg-ok-light border-ok-mid text-ok'
                  : 'bg-terra-light border-terra-mid text-terra')
              }
            >
              {generateMessage.msg}
            </div>
          )}
          <p className="text-[10px] text-ink-muted mt-2 leading-relaxed">
            Astuce : décris dégâts visibles, inspection menée (acoustique, traceur, thermo, capteur d&apos;humidité), conclusion sur l&apos;origine, et recommandations.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {SECTIONS.map(({ key, label, placeholder }) => {
          const isActive = activeDictation === key;
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[12px] font-bold text-navy">{label}</label>
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
                className="w-full bg-white border border-sand-border rounded-lg px-3 py-2 text-[13px] text-ink outline-none focus:border-navy-mid resize-y min-h-[80px] disabled:opacity-70 disabled:bg-sand-mid"
              />

              {/* Photos liées à cette section */}
              <SectionPhotos
                section={key}
                photos={photosBySection[key]}
                uploading={uploadingSection === key}
                disabled={alreadyPublished}
                onUpload={(file) => uploadPhotoToSection(key, file)}
                onMove={(photoId, delta) => movePhoto(key, photoId, delta)}
                onUnlink={(photoId) => unlinkPhoto(key, photoId)}
              />
            </div>
          );
        })}
      </div>

      {feedback && (
        <div
          className={
            'text-[11px] rounded-md px-3 py-2 mt-3 border font-semibold ' +
            (feedback.kind === 'ok'
              ? 'bg-ok-light border-ok-mid text-ok'
              : 'bg-terra-light border-terra-mid text-terra')
          }
        >
          {feedback.msg}
        </div>
      )}

      {!alreadyPublished ? (
        <>
          <div className="grid grid-cols-3 gap-2 mt-4">
            <button
              onClick={() => doSave()}
              disabled={pending || exportingWord}
              className="bg-[#A17244] text-white py-3 rounded-xl font-bold text-[13px] hover:bg-[#8A613B] disabled:opacity-50 active:opacity-80"
            >
              {pending ? '…' : 'Enregistrer'}
            </button>
            <button
              onClick={doExportWord}
              disabled={exportingWord || pending}
              className="bg-navy text-white py-3 rounded-xl font-bold text-[13px] hover:bg-navy-mid disabled:opacity-50 active:opacity-80"
            >
              {exportingWord ? 'Génération Word…' : '📄 Exporter Word'}
            </button>
            <button
              onClick={() => setPreviewOpen(true)}
              className="bg-sand-mid text-ink border border-sand-border py-3 rounded-xl font-bold text-[13px] hover:bg-sand-border active:opacity-80"
            >
              👁 Aperçu
            </button>
          </div>
          <button
            onClick={doPublish}
            disabled={pending || !canPublish || exportingWord}
            title={!canPublish ? 'Clôture l\'intervention avant de publier' : ''}
            className="w-full mt-2 bg-ok text-white py-3 rounded-xl font-bold text-[13px] disabled:opacity-40 active:opacity-80"
          >
            Publier ✓
          </button>
        </>
      ) : (
        <>
          <div className="bg-ok-light border border-ok-mid rounded-md px-3 py-2 text-[11px] text-ok text-center font-semibold mt-3">
            ✓ Rapport déjà publié
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={doExportWord}
              disabled={exportingWord}
              className="bg-navy text-white py-2.5 rounded-xl font-bold text-[12px] hover:bg-navy-mid disabled:opacity-50 active:opacity-80"
            >
              {exportingWord ? 'Génération Word…' : '📄 Exporter Word'}
            </button>
            <button
              onClick={() => setPreviewOpen(true)}
              className="bg-sand-mid text-ink border border-sand-border py-2.5 rounded-xl font-bold text-[12px] hover:bg-sand-border"
            >
              👁 Aperçu
            </button>
          </div>
        </>
      )}

      <button
        onClick={doDriveSync}
        disabled={pending}
        className="w-full mt-2 bg-[#A17244] text-white py-2.5 rounded-xl text-[12px] font-semibold hover:bg-[#8A613B] disabled:opacity-50"
      >
        ☁ Synchroniser vers Google Drive
      </button>

      {!supportsSpeech && (
        <p className="text-[10px] text-ink-muted mt-2 leading-relaxed">
          Dictée vocale indisponible sur ce navigateur. Chrome/Edge sur Android ou Safari iOS recommandé.
        </p>
      )}

      {/* Modal Aperçu — overlay plein écran, fond cream, sections en
          prose formatée. Affichage HTML simple (pas de PDF). */}
      {previewOpen && (
        <PreviewModal
          values={values}
          interventionRef={interventionRef ?? null}
          acpNom={acpNom ?? null}
          photosBySection={photosBySection}
          isDraft={!alreadyPublished}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </section>
  );
}

// ─── Sous-composant : zone photos d'une section ────────────────────────

function SectionPhotos({
  section, photos, uploading, disabled, onUpload, onMove, onUnlink,
}: {
  section: SectionKey;
  photos: SectionPhoto[];
  uploading: boolean;
  disabled: boolean;
  onUpload: (f: File) => void;
  onMove: (photoId: string, delta: -1 | 1) => void;
  onUnlink: (photoId: string) => void;
}) {
  const inputId = `photo-input-${section}`;
  return (
    <div className="mt-2">
      {/* Bouton ajouter */}
      {!disabled && (
        <>
          <input
            id={inputId}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.currentTarget.value = '';
            }}
          />
          <label
            htmlFor={inputId}
            className={
              'inline-block text-[10px] font-bold px-2.5 py-1 rounded-md cursor-pointer ' +
              (uploading
                ? 'bg-sand-mid text-ink-muted'
                : 'bg-sand-mid text-ink border border-sand-border hover:bg-sand-border')
            }
          >
            {uploading ? 'Upload…' : '📷 Ajouter photo'}
          </label>
        </>
      )}

      {/* Miniatures */}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {photos.map((p, idx) => (
            <div key={p.id} className="relative w-20 h-20 rounded-md overflow-hidden border border-sand-border bg-sand-mid group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.drive_url} alt={p.filename ?? 'photo'} className="w-full h-full object-cover" />
              {!disabled && (
                <div className="absolute inset-0 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-opacity bg-black/40">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => onUnlink(p.id)}
                      className="text-[12px] bg-terra text-white w-5 h-5 leading-none rounded-bl-md"
                      title="Retirer de la section"
                    >
                      ×
                    </button>
                  </div>
                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={() => onMove(p.id, -1)}
                      disabled={idx === 0}
                      className="text-white text-[12px] w-5 h-5 leading-none bg-navy/80 rounded-tr-md disabled:opacity-30"
                      title="Reculer"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(p.id, +1)}
                      disabled={idx === photos.length - 1}
                      className="text-white text-[12px] w-5 h-5 leading-none bg-navy/80 rounded-tl-md disabled:opacity-30"
                      title="Avancer"
                    >
                      →
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sous-composant : modal Aperçu ─────────────────────────────────────

function PreviewModal({
  values, interventionRef, acpNom, photosBySection, isDraft, onClose,
}: {
  values: RapportInput;
  interventionRef: string | null;
  acpNom: string | null;
  photosBySection: Record<SectionKey, SectionPhoto[]>;
  isDraft: boolean;
  onClose: () => void;
}) {
  // Escape ferme la modale.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const SECTIONS_PREV: { key: SectionKey; label: string }[] = [
    { key: 'degats',          label: 'Dégâts' },
    { key: 'inspection',      label: 'Inspection' },
    { key: 'conclusion',      label: 'Conclusion' },
    { key: 'recommandations', label: 'Recommandations' },
  ];

  const today = new Date().toLocaleDateString('fr-BE', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-[100] bg-cream overflow-y-auto" role="dialog" aria-modal="true">
      {/* Barre supérieure : fermer + badge BROUILLON */}
      <div className="sticky top-0 bg-cream/95 backdrop-blur border-b border-sand-border px-4 py-3 flex items-center justify-between z-10">
        <button
          type="button"
          onClick={onClose}
          className="text-[13px] font-bold text-ink-mid hover:text-ink"
        >
          ✕ Fermer
        </button>
        {isDraft && (
          <span className="bg-terra text-white text-[10px] font-extrabold uppercase tracking-widest px-3 py-1 rounded-full">
            Brouillon
          </span>
        )}
      </div>

      <div className="max-w-3xl mx-auto p-6">
        {/* En-tête FoxO */}
        <header className="border-b border-sand-border pb-4 mb-6">
          <div className="text-[28px] font-extrabold text-navy tracking-wide">FoxO</div>
          <div className="text-[10px] uppercase tracking-[.15em] text-ink-muted mt-1">
            Rapport d&apos;intervention
          </div>
          <div className="text-[12px] text-ink-mid mt-3 flex flex-wrap items-center gap-3">
            {interventionRef && (
              <span className="font-mono font-semibold text-ink">{interventionRef}</span>
            )}
            {acpNom && <span>· {acpNom}</span>}
            <span className="text-ink-muted">· {today}</span>
          </div>
        </header>

        {/* 4 sections */}
        {SECTIONS_PREV.map(({ key, label }) => {
          const text = values[key]?.trim();
          const photos = photosBySection[key];
          return (
            <section key={key} className="mb-6 pb-6 border-b border-sand-mid last:border-b-0">
              <h2 className="text-[15px] font-extrabold text-navy mb-2">{label}</h2>
              {text ? (
                <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{text}</p>
              ) : (
                <p className="text-[12px] text-ink-muted italic">— section vide —</p>
              )}
              {photos.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                  {photos.map((p) => (
                    <div key={p.id} className="aspect-square rounded-md overflow-hidden border border-sand-border bg-sand-mid">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.drive_url} alt={p.filename ?? 'photo'} className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        <p className="text-[10px] text-ink-muted italic text-center pt-4">
          Aperçu HTML — relis avant publication. Le PDF final sera généré et envoyé au syndic.
        </p>
      </div>
    </div>
  );
}
