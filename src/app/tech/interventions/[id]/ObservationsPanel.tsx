'use client';

import { useEffect, useState } from 'react';
import {
  Beaker, Camera, Droplet, Eye, Gauge, HelpCircle,
  ImagePlus, Plus, Thermometer, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type TestType =
  | 'Test colorant'
  | 'Test de pression'
  | 'Thermographie'
  | 'Inspection visuelle'
  | 'Caméra endoscopique'
  | "Capteur d'humidité"
  | 'Autre';

const TEST_TYPES: TestType[] = [
  'Test colorant',
  'Test de pression',
  'Thermographie',
  'Inspection visuelle',
  'Caméra endoscopique',
  "Capteur d'humidité",
  'Autre',
];

const ICON_BY_TYPE: Record<TestType, LucideIcon> = {
  'Test colorant':       Beaker,
  'Test de pression':    Gauge,
  'Thermographie':       Thermometer,
  'Inspection visuelle': Eye,
  'Caméra endoscopique': Camera,
  "Capteur d'humidité":  Droplet,
  'Autre':               HelpCircle,
};

type ObsPhoto = {
  id: string;
  drive_url: string;
  filename: string | null;
};

type Observation = {
  id: string;
  test_type: string;
  etage: string | null;
  localisation: string | null;
  notes: string | null;
  ordre: number;
  photos: ObsPhoto[];
};

type FormData = {
  test_type: TestType;
  etage: string;
  localisation: string;
  notes: string;
};

const EMPTY_FORM: FormData = {
  test_type: 'Test colorant',
  etage: '',
  localisation: '',
  notes: '',
};

// Panneau « Observations terrain » — liste les tests/constatations menées
// sur site, avec photos liées (via photos_interventions.observation_id).
// Logique métier : 1 GET au mount (observations + photos), POST pour ajout,
// DELETE pour suppression, POST/DELETE sur sub-route photos pour lier/délier.
export function ObservationsPanel({
  interventionId,
  disabled = false,
}: {
  interventionId: string;
  disabled?: boolean;
}) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [unlinkedPhotos, setUnlinkedPhotos] = useState<ObsPhoto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  // Photo optionnelle à uploader avec la nouvelle observation (capturée
  // depuis l'input file du formulaire ; uploadée puis liée dans createObs).
  const [formPhotos, setFormPhotos] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Affiche le picker de photos libres pour cette observation (id) ou null.
  const [linkingForObs, setLinkingForObs] = useState<string | null>(null);
  // Indique quelle observation est en cours d'upload de nouvelles photos
  // (séquentiel sur la liste de fichiers sélectionnés). null = idle.
  const [uploadingForObs, setUploadingForObs] = useState<string | null>(null);

  // Load observations + photos en parallèle au mount.
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      try {
        const [obsRes, phRes] = await Promise.all([
          fetch(`/api/tech/observations?intervention_id=${interventionId}`).then((r) => r.json()),
          fetch(`/api/tech/photos?intervention_id=${interventionId}`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        if (!obsRes.ok) {
          setError(obsRes.error ?? 'Erreur observations.');
          setLoading(false);
          return;
        }
        if (!phRes.ok) {
          setError(phRes.error ?? 'Erreur photos.');
          setLoading(false);
          return;
        }
        setObservations((obsRes.observations as Observation[]) ?? []);
        const allPhotos = (phRes.photos as Array<ObsPhoto & { observation_id: string | null }>) ?? [];
        setUnlinkedPhotos(allPhotos.filter((p) => !p.observation_id));
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Erreur réseau.');
        setLoading(false);
      }
    }
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [interventionId]);

  async function createObs() {
    setError(null);
    try {
      const r = await fetch('/api/tech/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intervention_id: interventionId,
          test_type: formData.test_type,
          etage: formData.etage,
          localisation: formData.localisation,
          notes: formData.notes,
        }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Erreur création.');
        return;
      }
      const obs = data.observation as Omit<Observation, 'photos'>;

      // Photos optionnelles : pour chaque fichier, upload via
      // /api/tech/upload-photo (FormData : file + intervention_id, sans
      // section), puis lien à l'observation via POST
      // /api/tech/observations/[id]/photos. La réponse upload expose
      // { id, drive_url, filename } à la racine (pas wrappé). Échec
      // d'un fichier = continue avec les suivants.
      const photos: ObsPhoto[] = [];
      for (const file of formPhotos) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('intervention_id', interventionId);
        const uploadRes = await fetch('/api/tech/upload-photo', {
          method: 'POST',
          body: fd,
        }).then((r) => r.json());
        if (!uploadRes.ok || !uploadRes.id) continue;
        const newPhoto: ObsPhoto = {
          id: uploadRes.id,
          drive_url: uploadRes.drive_url,
          filename: uploadRes.filename ?? null,
        };
        const linkRes = await fetch(`/api/tech/observations/${obs.id}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo_id: newPhoto.id }),
        }).then((r) => r.json());
        if (linkRes.ok) {
          photos.push(newPhoto);
        }
      }

      setObservations((prev) => [...prev, { ...obs, photos }]);
      setShowForm(false);
      setFormData(EMPTY_FORM);
      setFormPhotos([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    }
  }

  async function deleteObs(obsId: string) {
    if (!confirm('Supprimer cette observation ?')) return;
    setError(null);
    try {
      const r = await fetch(`/api/tech/observations/${obsId}`, { method: 'DELETE' });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Erreur suppression.');
        return;
      }
      // Les photos liées redeviennent libres
      const obs = observations.find((o) => o.id === obsId);
      if (obs && obs.photos.length > 0) {
        setUnlinkedPhotos((prev) => [...prev, ...obs.photos]);
      }
      setObservations((prev) => prev.filter((o) => o.id !== obsId));
      if (linkingForObs === obsId) setLinkingForObs(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    }
  }

  async function linkPhoto(obsId: string, photo: ObsPhoto) {
    setError(null);
    try {
      const r = await fetch(`/api/tech/observations/${obsId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_id: photo.id }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Erreur liaison.');
        return;
      }
      setObservations((prev) =>
        prev.map((o) => (o.id === obsId ? { ...o, photos: [...o.photos, photo] } : o)),
      );
      setUnlinkedPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    }
  }

  async function unlinkPhoto(obsId: string, photo: ObsPhoto) {
    setError(null);
    try {
      const r = await fetch(`/api/tech/observations/${obsId}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_id: photo.id }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error ?? 'Erreur détachement.');
        return;
      }
      setObservations((prev) =>
        prev.map((o) =>
          o.id === obsId ? { ...o, photos: o.photos.filter((p) => p.id !== photo.id) } : o,
        ),
      );
      setUnlinkedPhotos((prev) => [...prev, photo]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    }
  }

  // Upload séquentiel d'une liste de fichiers + lien immédiat à l'observation.
  // Pour chaque fichier : POST /api/tech/upload-photo (FormData : file +
  // intervention_id sans section, la photo n'appartient à aucune section
  // du rapport mais à l'observation), puis POST sur la sub-route photos.
  // En cas d'échec d'un fichier, on continue avec les suivants — chaque
  // photo est indépendante du point de vue persistance.
  async function uploadPhotosForObs(obsId: string, files: File[]) {
    setError(null);
    setUploadingForObs(obsId);
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('intervention_id', interventionId);
        const uploadRes = await fetch('/api/tech/upload-photo', {
          method: 'POST',
          body: fd,
        }).then((r) => r.json());
        if (!uploadRes.ok || !uploadRes.id) {
          setError(uploadRes.error ?? 'Upload échoué.');
          continue;
        }
        const newPhoto: ObsPhoto = {
          id: uploadRes.id,
          drive_url: uploadRes.drive_url,
          filename: uploadRes.filename ?? null,
        };
        const linkRes = await fetch(`/api/tech/observations/${obsId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo_id: newPhoto.id }),
        }).then((r) => r.json());
        if (!linkRes.ok) {
          setError(linkRes.error ?? 'Liaison échouée.');
          continue;
        }
        setObservations((prev) =>
          prev.map((o) => (o.id === obsId ? { ...o, photos: [...o.photos, newPhoto] } : o)),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau.');
    } finally {
      setUploadingForObs(null);
    }
  }

  const cardStyle = { boxShadow: '0 1px 2px rgba(15,32,64,0.04), 0 4px 12px rgba(15,32,64,0.05), 0 0 0 1px rgba(15,32,64,0.04)' };

  // ─── Loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="bg-[var(--color-cream)] rounded-xl p-4" style={cardStyle}>
        <div className="flex items-center gap-2.5 mb-2">
          <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
          <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">Observations terrain</div>
        </div>
        <div className="text-[13px] text-[var(--color-ink-mid)]">Chargement…</div>
      </section>
    );
  }

  return (
    <section className="bg-[var(--color-cream)] rounded-xl p-4" style={cardStyle}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5">
          <span className="w-[3px] h-3.5 rounded-sm bg-[var(--accent-tech)]"></span>
          <div className="font-sora text-[11px] font-medium text-[var(--color-ink-mid)] uppercase tracking-[0.12em]">Observations terrain</div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="bg-[var(--color-navy)] hover:bg-[var(--color-navy-dark)] text-[var(--color-cream)] px-3.5 py-2 rounded-md text-[13px] font-semibold inline-flex items-center gap-1.5 transition-colors active:scale-95 min-h-[44px]"
          >
            <Plus size={15} />
            {showForm ? 'Fermer' : 'Ajouter'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 text-[12px] text-[var(--color-terra)] bg-[var(--color-terra-light)] border border-[var(--color-terra-mid)] rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Formulaire ajout */}
      {showForm && !disabled && (
        <div className="bg-[var(--color-sand)] border border-[var(--color-sand-border)] rounded-lg p-4 mb-3 space-y-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-mid)] block mb-1.5">Type de test</label>
            <select
              value={formData.test_type}
              onChange={(e) => setFormData((f) => ({ ...f, test_type: e.target.value as TestType }))}
              className="w-full px-3.5 py-3 border border-[var(--color-sand-border)] rounded-md text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] min-h-[44px]"
            >
              {TEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={formData.etage}
              onChange={(e) => setFormData((f) => ({ ...f, etage: e.target.value }))}
              placeholder="Étage (ex: 2ème)"
              maxLength={100}
              className="px-3.5 py-3 border border-[var(--color-sand-border)] rounded-md text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] min-h-[44px]"
            />
            <input
              type="text"
              value={formData.localisation}
              onChange={(e) => setFormData((f) => ({ ...f, localisation: e.target.value }))}
              placeholder="Localisation (ex: Apt 4, Cuisine)"
              maxLength={200}
              className="px-3.5 py-3 border border-[var(--color-sand-border)] rounded-md text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] min-h-[44px]"
            />
          </div>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Constatations…"
            rows={2}
            maxLength={5000}
            className="w-full px-3.5 py-3 border border-[var(--color-sand-border)] rounded-md text-[14px] bg-[var(--color-cream)] text-[var(--color-ink)] outline-none focus:border-[var(--accent-tech)] resize-y"
          />
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-mid)] block mb-1.5">
              Photos (optionnel)
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              onChange={(e) => setFormPhotos(Array.from(e.target.files ?? []))}
              className="w-full text-[13px] text-[var(--color-ink-mid)] file:mr-2 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-[var(--color-navy)] file:text-[var(--color-cream)] file:text-[13px] file:font-semibold file:cursor-pointer"
            />
            {formPhotos.length > 0 && (
              <p className="text-[12px] text-[var(--color-ink-mid)] mt-1.5">
                {formPhotos.length} fichier{formPhotos.length > 1 ? 's' : ''} sélectionné{formPhotos.length > 1 ? 's' : ''}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={createObs}
              className="flex-1 bg-[var(--color-ok)] text-[var(--color-cream)] py-3 rounded-md text-[14px] font-semibold transition-opacity hover:opacity-90 min-h-[48px]"
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormData(EMPTY_FORM);
                setFormPhotos([]);
              }}
              className="flex-1 bg-[var(--color-cream)] border border-[var(--color-sand-border)] text-[var(--color-ink)] py-3 rounded-md text-[14px] font-medium hover:bg-[var(--color-sand-hover)] min-h-[48px] transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste des observations */}
      {observations.length === 0 && !showForm && (
        <div className="text-[13px] text-[var(--color-ink-mid)] italic">
          Aucune observation pour cette intervention.
        </div>
      )}

      {observations.length > 0 && (
        <div className="space-y-3">
          {observations.map((obs) => {
            const Icon = ICON_BY_TYPE[obs.test_type as TestType] ?? HelpCircle;
            const isLinking = linkingForObs === obs.id;
            return (
              <div
                key={obs.id}
                className="bg-[var(--color-sand)] border border-[var(--color-sand-border)] rounded-lg p-3.5 relative"
              >
                {/* Bouton supprimer */}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => deleteObs(obs.id)}
                    className="absolute top-2 right-2 w-9 h-9 rounded-full bg-[var(--color-sand-mid)] hover:bg-[var(--color-terra)] hover:text-[var(--color-cream)] text-[var(--color-ink-muted)] flex items-center justify-center transition-colors"
                    title="Supprimer l'observation"
                    aria-label="Supprimer l'observation"
                  >
                    <X size={16} />
                  </button>
                )}

                {/* Bandeau */}
                <div className="flex items-center gap-2 mb-2 pr-10 flex-wrap">
                  <Icon size={17} className="text-[var(--accent-tech)] shrink-0" />
                  <span className="text-[14px] font-semibold text-[var(--color-ink)]">{obs.test_type}</span>
                  {(obs.etage || obs.localisation) && (
                    <span className="text-[11px] font-medium text-[var(--color-ink)] bg-[var(--color-sand-mid)] px-2.5 py-1 rounded-full">
                      {[obs.etage, obs.localisation].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>

                {/* Notes */}
                {obs.notes && (
                  <p className="text-[13px] text-[var(--color-ink)] whitespace-pre-wrap mb-2 leading-relaxed">{obs.notes}</p>
                )}

                {/* Photos liées */}
                {obs.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {obs.photos.map((p) => (
                      <div
                        key={p.id}
                        className="relative w-[80px] h-[80px] rounded-md overflow-hidden border border-[var(--color-sand-border)] bg-[var(--color-sand-mid)] group"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.drive_url}
                          alt={p.filename ?? 'photo'}
                          className="w-full h-full object-cover"
                        />
                        {!disabled && (
                          <button
                            type="button"
                            onClick={() => unlinkPhoto(obs.id, p)}
                            className="absolute top-0 right-0 w-7 h-7 bg-[var(--color-terra)] text-[var(--color-cream)] text-[14px] leading-none rounded-bl-md flex items-center justify-center transition-opacity opacity-90"
                            title="Détacher"
                            aria-label="Détacher la photo"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions photos : upload direct + lier une existante */}
                {!disabled && (
                  <>
                    <div className="flex items-center gap-3 flex-wrap">
                      <input
                        id={`obs-upload-${obs.id}`}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        disabled={uploadingForObs === obs.id}
                        onChange={(e) => {
                          const input = e.currentTarget;
                          const files = Array.from(input.files ?? []);
                          if (files.length > 0) void uploadPhotosForObs(obs.id, files);
                          input.value = '';
                        }}
                      />
                      <label
                        htmlFor={`obs-upload-${obs.id}`}
                        className={
                          'text-[12px] text-[var(--accent-tech)] font-semibold underline inline-flex items-center gap-1 min-h-[44px] py-2 ' +
                          (uploadingForObs === obs.id ? 'cursor-wait opacity-70' : 'cursor-pointer')
                        }
                      >
                        <Camera size={14} />
                        {uploadingForObs === obs.id ? 'Upload…' : 'Ajouter photos'}
                      </label>
                      <button
                        type="button"
                        onClick={() => setLinkingForObs(isLinking ? null : obs.id)}
                        disabled={unlinkedPhotos.length === 0}
                        className="text-[12px] text-[var(--accent-tech)] font-semibold underline disabled:text-[var(--color-ink-muted)] disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1 min-h-[44px] py-2"
                      >
                        <ImagePlus size={14} />
                        {unlinkedPhotos.length === 0
                          ? 'Aucune photo libre à lier'
                          : isLinking
                            ? 'Fermer'
                            : `Lier une photo (${unlinkedPhotos.length} libre${unlinkedPhotos.length > 1 ? 's' : ''})`}
                      </button>
                    </div>
                    {isLinking && unlinkedPhotos.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {unlinkedPhotos.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => linkPhoto(obs.id, p)}
                            className="w-[80px] h-[80px] rounded-md overflow-hidden border-2 border-[var(--color-sand-border)] hover:border-[var(--accent-tech)] bg-[var(--color-sand-mid)] transition-colors"
                            title="Cliquer pour lier"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={p.drive_url}
                              alt={p.filename ?? 'photo'}
                              className="w-full h-full object-cover"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
