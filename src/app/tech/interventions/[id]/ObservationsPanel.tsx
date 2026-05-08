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
  const [formPhoto, setFormPhoto] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Affiche le picker de photos libres pour cette observation (id) ou null.
  const [linkingForObs, setLinkingForObs] = useState<string | null>(null);

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

      // Photo optionnelle : upload via /api/tech/upload-photo (FormData
      // attendue : file + intervention_id), puis lien à l'observation
      // via POST /api/tech/observations/[id]/photos. La réponse upload
      // expose { id, drive_url, filename } à la racine (pas un objet
      // photo enveloppé), on construit l'ObsPhoto à partir de ça.
      let photos: ObsPhoto[] = [];
      if (formPhoto) {
        const fd = new FormData();
        fd.append('file', formPhoto);
        fd.append('intervention_id', interventionId);
        const uploadRes = await fetch('/api/tech/upload-photo', {
          method: 'POST',
          body: fd,
        }).then((r) => r.json());
        if (uploadRes.ok && uploadRes.id) {
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
            photos = [newPhoto];
          }
        }
      }

      setObservations((prev) => [...prev, { ...obs, photos }]);
      setShowForm(false);
      setFormData(EMPTY_FORM);
      setFormPhoto(null);
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

  // ─── Loading ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <section className="premium-card">
        <div className="section-label mb-2">Observations terrain</div>
        <div className="text-[12px] text-ink-muted">Chargement…</div>
      </section>
    );
  }

  return (
    <section className="premium-card">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="section-label">Observations terrain</div>
        {!disabled && (
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            className="bg-navy text-white px-3 py-2.5 rounded-md text-[12px] font-bold inline-flex items-center gap-1.5 transition-opacity hover:opacity-90 active:scale-95"
          >
            <Plus size={14} />
            {showForm ? 'Fermer' : 'Ajouter'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-2 text-[11px] text-terra bg-terra-light border border-terra-mid rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Formulaire ajout */}
      {showForm && !disabled && (
        <div className="bg-white border border-sand-border rounded-lg p-3 mb-3 space-y-2">
          <div>
            <label className="text-[11px] font-semibold text-ink-mid block mb-1">Type de test</label>
            <select
              value={formData.test_type}
              onChange={(e) => setFormData((f) => ({ ...f, test_type: e.target.value as TestType }))}
              className="w-full px-3 py-2.5 border border-sand-border rounded-md text-[13px] bg-white outline-none focus:border-navy-mid"
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
              className="px-3 py-2.5 border border-sand-border rounded-md text-[13px] bg-white outline-none focus:border-navy-mid"
            />
            <input
              type="text"
              value={formData.localisation}
              onChange={(e) => setFormData((f) => ({ ...f, localisation: e.target.value }))}
              placeholder="Localisation (ex: Apt 4, Cuisine)"
              maxLength={200}
              className="px-3 py-2.5 border border-sand-border rounded-md text-[13px] bg-white outline-none focus:border-navy-mid"
            />
          </div>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Constatations…"
            rows={2}
            maxLength={5000}
            className="w-full px-3 py-2.5 border border-sand-border rounded-md text-[13px] bg-white outline-none focus:border-navy-mid resize-y"
          />
          <div>
            <label className="text-[11px] font-semibold text-ink-mid block mb-1">
              Photo (optionnel)
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFormPhoto(e.target.files?.[0] ?? null)}
              className="w-full text-[12px] text-ink-mid file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-navy file:text-white file:text-[12px] file:font-semibold"
            />
            {formPhoto && (
              <p className="text-[11px] text-ink-muted mt-1">{formPhoto.name}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={createObs}
              className="flex-1 bg-ok text-white py-2.5 rounded-md text-[13px] font-bold transition-opacity hover:opacity-90"
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormData(EMPTY_FORM);
                setFormPhoto(null);
              }}
              className="flex-1 bg-sand-mid text-ink py-2.5 rounded-md text-[13px] font-semibold hover:bg-sand-border"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Liste des observations */}
      {observations.length === 0 && !showForm && (
        <div className="text-[12px] text-ink-muted italic">
          Aucune observation pour cette intervention.
        </div>
      )}

      {observations.length > 0 && (
        <div className="space-y-2">
          {observations.map((obs) => {
            const Icon = ICON_BY_TYPE[obs.test_type as TestType] ?? HelpCircle;
            const isLinking = linkingForObs === obs.id;
            return (
              <div
                key={obs.id}
                className="bg-white border border-sand-border rounded-lg p-3 relative"
              >
                {/* Bouton supprimer */}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => deleteObs(obs.id)}
                    className="absolute top-2 right-2 w-6 h-6 rounded-full bg-sand-mid hover:bg-terra hover:text-white text-ink-muted flex items-center justify-center transition-colors"
                    title="Supprimer l'observation"
                    aria-label="Supprimer l'observation"
                  >
                    <X size={14} />
                  </button>
                )}

                {/* Bandeau */}
                <div className="flex items-center gap-2 mb-1.5 pr-8 flex-wrap">
                  <Icon size={16} className="text-navy shrink-0" />
                  <span className="text-[13px] font-bold text-navy">{obs.test_type}</span>
                  {(obs.etage || obs.localisation) && (
                    <span className="text-[11px] text-ink-muted bg-sand-mid px-2 py-0.5 rounded-full">
                      {[obs.etage, obs.localisation].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>

                {/* Notes */}
                {obs.notes && (
                  <p className="text-[12px] text-ink-mid whitespace-pre-wrap mb-2">{obs.notes}</p>
                )}

                {/* Photos liées */}
                {obs.photos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {obs.photos.map((p) => (
                      <div
                        key={p.id}
                        className="relative w-[60px] h-[60px] rounded-md overflow-hidden border border-sand-border bg-sand-mid group"
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
                            className="absolute top-0 right-0 w-5 h-5 bg-terra text-white text-[12px] leading-none rounded-bl-md opacity-0 group-hover:opacity-100 transition-opacity"
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

                {/* Lier une photo */}
                {!disabled && (
                  <>
                    <button
                      type="button"
                      onClick={() => setLinkingForObs(isLinking ? null : obs.id)}
                      disabled={unlinkedPhotos.length === 0}
                      className="text-[11px] text-navy underline disabled:text-ink-muted disabled:no-underline disabled:cursor-not-allowed inline-flex items-center gap-1"
                    >
                      <ImagePlus size={12} />
                      {unlinkedPhotos.length === 0
                        ? 'Aucune photo libre à lier'
                        : isLinking
                          ? 'Fermer'
                          : `Lier une photo (${unlinkedPhotos.length} libre${unlinkedPhotos.length > 1 ? 's' : ''})`}
                    </button>
                    {isLinking && unlinkedPhotos.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {unlinkedPhotos.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => linkPhoto(obs.id, p)}
                            className="w-[60px] h-[60px] rounded-md overflow-hidden border-2 border-sand-border hover:border-navy bg-sand-mid transition-colors"
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
