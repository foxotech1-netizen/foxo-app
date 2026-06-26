'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowUpRight,
  Circle,
  MousePointer2,
  Pencil,
  Redo2,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';

// Editeur d'annotation d'UNE photo de rapport.
// - Charge l'image ORIGINALE via GET /api/admin/photos/[id] (meme origine -> pas de "tainted canvas").
// - Outils : selection / fleche / cercle / rectangle / ligne / trace libre / texte.
// - Annuler / Refaire (historique) + selection d'une annotation pour la supprimer.
// - Coordonnees NORMALISEES (0..1) => apercu interactif et export pleine resolution identiques.
// - Enregistre via POST (image aplatie JPEG + JSON des annotations re-editable).

export type Annotation =
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; color: string; sw: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; sw: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; sw: number }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number; color: string; sw: number }
  | { kind: 'free'; pts: number[]; color: string; sw: number }
  | { kind: 'text'; x: number; y: number; text: string; color: string; size: number };

type Tool = 'select' | 'arrow' | 'ellipse' | 'rect' | 'line' | 'free' | 'text';

const COLORS = ['#FF3B30', '#FFCC00', '#34C759', '#FFFFFF', '#000000'];
const STROKES: { label: string; sw: number }[] = [
  { label: 'Fin', sw: 0.004 },
  { label: 'Moyen', sw: 0.007 },
  { label: 'Epais', sw: 0.012 },
];
const DEFAULT_TEXT_SIZE = 0.045;
const HIT_TOL = 0.025;

function isDegenerate(d: Annotation): boolean {
  if (d.kind === 'arrow' || d.kind === 'line') return Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 0.01;
  if (d.kind === 'rect' || d.kind === 'ellipse') return d.w < 0.01 && d.h < 0.01;
  if (d.kind === 'free') return d.pts.length < 6;
  return false;
}

function bboxOf(a: Annotation): { x: number; y: number; w: number; h: number } {
  if (a.kind === 'arrow' || a.kind === 'line') {
    return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  }
  if (a.kind === 'rect' || a.kind === 'ellipse') {
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
  if (a.kind === 'free') {
    let minx = 1, miny = 1, maxx = 0, maxy = 0;
    for (let i = 0; i + 1 < a.pts.length; i += 2) {
      minx = Math.min(minx, a.pts[i]); maxx = Math.max(maxx, a.pts[i]);
      miny = Math.min(miny, a.pts[i + 1]); maxy = Math.max(maxy, a.pts[i + 1]);
    }
    return { x: minx, y: miny, w: Math.max(0, maxx - minx), h: Math.max(0, maxy - miny) };
  }
  const w = Math.min(0.6, Math.max(0.05, a.text.length * a.size * 0.5));
  return { x: a.x, y: a.y, w, h: a.size };
}

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hitTest(a: Annotation, px: number, py: number, tol: number): boolean {
  if (a.kind === 'arrow' || a.kind === 'line') return distToSeg(px, py, a.x1, a.y1, a.x2, a.y2) <= tol;
  if (a.kind === 'free') {
    for (let i = 0; i + 3 < a.pts.length; i += 2) {
      if (distToSeg(px, py, a.pts[i], a.pts[i + 1], a.pts[i + 2], a.pts[i + 3]) <= tol) return true;
    }
    return false;
  }
  const b = bboxOf(a);
  return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
}

function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, outW: number, outH: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (a.kind === 'text') {
    const px = Math.max(8, a.size * outH);
    ctx.font = `700 ${px}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.lineWidth = Math.max(2, px * 0.14);
    ctx.strokeStyle = a.color === '#FFFFFF' ? '#000000' : '#FFFFFF';
    ctx.strokeText(a.text, a.x * outW, a.y * outH);
    ctx.fillStyle = a.color;
    ctx.fillText(a.text, a.x * outW, a.y * outH);
    return;
  }
  const lw = Math.max(1, a.sw * outW);
  ctx.lineWidth = lw;
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  if (a.kind === 'arrow' || a.kind === 'line') {
    const x1 = a.x1 * outW, y1 = a.y1 * outH, x2 = a.x2 * outW, y2 = a.y2 * outH;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (a.kind === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(lw * 3.2, outW * 0.018);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(ang - Math.PI / 6), y2 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(x2 - head * Math.cos(ang + Math.PI / 6), y2 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  if (a.kind === 'rect') {
    ctx.strokeRect(a.x * outW, a.y * outH, a.w * outW, a.h * outH);
    return;
  }
  if (a.kind === 'ellipse') {
    const cx = (a.x + a.w / 2) * outW;
    const cy = (a.y + a.h / 2) * outH;
    const rx = Math.abs(a.w / 2) * outW;
    const ry = Math.abs(a.h / 2) * outH;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (a.kind === 'free') {
    if (a.pts.length < 4) return;
    ctx.beginPath();
    ctx.moveTo(a.pts[0] * outW, a.pts[1] * outH);
    for (let i = 2; i + 1 < a.pts.length; i += 2) ctx.lineTo(a.pts[i] * outW, a.pts[i + 1] * outH);
    ctx.stroke();
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, a: Annotation, outW: number, outH: number) {
  const b = bboxOf(a);
  const pad = 0.012;
  ctx.save();
  ctx.strokeStyle = '#2A5298';
  ctx.lineWidth = Math.max(1.5, outW * 0.003);
  ctx.setLineDash([Math.max(4, outW * 0.01), Math.max(3, outW * 0.008)]);
  ctx.strokeRect((b.x - pad) * outW, (b.y - pad) * outH, (b.w + pad * 2) * outW, (b.h + pad * 2) * outH);
  ctx.restore();
}

function renderAll(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  shapes: Annotation[],
  draft: Annotation | null,
  outW: number,
  outH: number,
) {
  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);
  for (const s of shapes) drawAnnotation(ctx, s, outW, outH);
  if (draft) drawAnnotation(ctx, draft, outW, outH);
}

export default function PhotoAnnotator({
  photoId,
  initialAnnotations,
  onClose,
  onSaved,
}: {
  photoId: string;
  initialAnnotations: Annotation[] | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const natRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const draftRef = useRef<Annotation | null>(null);
  const drawing = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [shapes, setShapes] = useState<Annotation[]>(initialAnnotations ?? []);
  const [past, setPast] = useState<Annotation[][]>([]);
  const [future, setFuture] = useState<Annotation[][]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<Annotation | null>(null);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [sw, setSw] = useState<number>(STROKES[1].sw);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      natRef.current = { w: img.naturalWidth || 1200, h: img.naturalHeight || 900 };
      setLoading(false);
    };
    img.onerror = () => {
      if (cancelled) return;
      setLoadErr('Impossible de charger la photo.');
      setLoading(false);
    };
    img.src = `/api/admin/photos/${photoId}`;
    return () => { cancelled = true; };
  }, [photoId]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderAll(ctx, img, shapes, draft, canvas.width, canvas.height);
    if (selectedIdx != null && shapes[selectedIdx]) drawSelection(ctx, shapes[selectedIdx], canvas.width, canvas.height);
  }, [shapes, draft, selectedIdx]);

  useEffect(() => {
    if (loading || loadErr) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nat = natRef.current;
    const baseW = nat.w || 1200;
    const baseH = nat.h || 900;
    const scale = Math.min(920, baseW) / baseW;
    const cw = Math.max(1, Math.round(baseW * scale));
    const ch = Math.max(1, Math.round(baseH * scale));
    if (canvas.width !== cw) canvas.width = cw;
    if (canvas.height !== ch) canvas.height = ch;
    paint();
  }, [loading, loadErr, paint]);

  const commit = useCallback((next: Annotation[]) => {
    setPast((p) => [...p, shapes]);
    setShapes(next);
    setFuture([]);
  }, [shapes]);

  function undo() {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([shapes, ...future]);
    setShapes(prev);
    setSelectedIdx(null);
  }

  function redo() {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, shapes]);
    setShapes(next);
    setSelectedIdx(null);
  }

  function deleteSelected() {
    if (selectedIdx == null) return;
    commit(shapes.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  }

  function clearAll() {
    if (shapes.length === 0) return;
    commit([]);
    setSelectedIdx(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selectedIdx != null) deleteSelected();
      } else if (e.key === 'Escape') {
        setSelectedIdx(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past, future, shapes, selectedIdx]);

  function toNorm(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (loading || loadErr) return;
    const p = toNorm(e);
    if (tool === 'select') {
      let found: number | null = null;
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitTest(shapes[i], p.x, p.y, HIT_TOL)) { found = i; break; }
      }
      setSelectedIdx(found);
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Texte a afficher :')?.trim();
      if (text) commit([...shapes, { kind: 'text', x: p.x, y: p.y, text, color, size: DEFAULT_TEXT_SIZE }]);
      return;
    }
    setSelectedIdx(null);
    drawing.current = true;
    startRef.current = p;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
    if (tool === 'free') {
      const d0: Annotation = { kind: 'free', pts: [p.x, p.y], color, sw };
      draftRef.current = d0;
      setDraft(d0);
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !startRef.current) return;
    const p = toNorm(e);
    const s = startRef.current;
    let nd: Annotation | null = null;
    if (tool === 'free') {
      const prev = draftRef.current;
      const pts = prev && prev.kind === 'free' ? [...prev.pts, p.x, p.y] : [s.x, s.y, p.x, p.y];
      nd = { kind: 'free', pts, color, sw };
    } else if (tool === 'arrow' || tool === 'line') {
      nd = { kind: tool, x1: s.x, y1: s.y, x2: p.x, y2: p.y, color, sw };
    } else if (tool === 'rect' || tool === 'ellipse') {
      nd = { kind: tool, x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y), color, sw };
    }
    draftRef.current = nd;
    setDraft(nd);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const d = draftRef.current;
    if (d && !isDegenerate(d)) commit([...shapes, d]);
    draftRef.current = null;
    setDraft(null);
    startRef.current = null;
  }

  async function save() {
    const img = imgRef.current;
    if (!img) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const nat = natRef.current;
      const off = document.createElement('canvas');
      off.width = nat.w || 1200;
      off.height = nat.h || 900;
      const octx = off.getContext('2d');
      if (!octx) throw new Error('canvas indisponible');
      renderAll(octx, img, shapes, null, off.width, off.height);
      const blob: Blob | null = await new Promise((res) => off.toBlob((b) => res(b), 'image/jpeg', 0.92));
      if (!blob) throw new Error('export image echoue');
      const fd = new FormData();
      fd.append('file', new File([blob], 'annotated.jpg', { type: 'image/jpeg' }));
      fd.append('annotations', JSON.stringify(shapes));
      const r = await fetch(`/api/admin/photos/${photoId}`, { method: 'POST', body: fd });
      const data = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !data.ok) throw new Error(data.error || `Erreur ${r.status}`);
      onSaved();
      onClose();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Echec de l enregistrement.');
    } finally {
      setSaving(false);
    }
  }

  async function removeAnnotation() {
    if (!window.confirm('Retirer l annotation et revenir a la photo originale ?')) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const r = await fetch(`/api/admin/photos/${photoId}`, { method: 'DELETE' });
      const data = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !data.ok) throw new Error(data.error || `Erreur ${r.status}`);
      onSaved();
      onClose();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Echec.');
    } finally {
      setSaving(false);
    }
  }

  const TOOLS: { t: Tool; label: string; Icon: LucideIcon }[] = [
    { t: 'select', label: 'Selectionner', Icon: MousePointer2 },
    { t: 'arrow', label: 'Fleche', Icon: ArrowUpRight },
    { t: 'ellipse', label: 'Cercle', Icon: Circle },
    { t: 'rect', label: 'Rectangle', Icon: Square },
    { t: 'line', label: 'Ligne', Icon: Slash },
    { t: 'free', label: 'Crayon', Icon: Pencil },
    { t: 'text', label: 'Texte', Icon: Type },
  ];
  const hasInitial = !!(initialAnnotations && initialAnnotations.length > 0);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-deep/60 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-center gap-2 border-b border-sand-border px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {TOOLS.map((it) => {
              const Icon = it.Icon;
              return (
                <button
                  key={it.t}
                  type="button"
                  title={it.label}
                  aria-label={it.label}
                  onClick={() => { setTool(it.t); if (it.t !== 'select') setSelectedIdx(null); }}
                  className={`rounded-md p-1.5 ${tool === it.t ? 'bg-navy text-white' : 'bg-sand text-ink hover:bg-sand-border'}`}
                >
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
          <div className="mx-1 h-5 w-px bg-sand-border" />
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Couleur ${c}`}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border ${color === c ? 'ring-2 ring-navy ring-offset-1' : 'border-sand-border'}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="mx-1 h-5 w-px bg-sand-border" />
          <div className="flex gap-1">
            {STROKES.map((st) => (
              <button
                key={st.label}
                type="button"
                onClick={() => setSw(st.sw)}
                className={`rounded-md px-2 py-1.5 text-xs font-semibold ${sw === st.sw ? 'bg-navy text-white' : 'bg-sand text-ink hover:bg-sand-border'}`}
              >
                {st.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" title="Annuler (Ctrl+Z)" aria-label="Annuler" onClick={undo} disabled={past.length === 0} className="rounded-md bg-sand p-1.5 text-ink hover:bg-sand-border disabled:opacity-40"><Undo2 size={16} /></button>
            <button type="button" title="Refaire (Ctrl+Y)" aria-label="Refaire" onClick={redo} disabled={future.length === 0} className="rounded-md bg-sand p-1.5 text-ink hover:bg-sand-border disabled:opacity-40"><Redo2 size={16} /></button>
            <button type="button" title="Supprimer la selection (Suppr)" aria-label="Supprimer la selection" onClick={deleteSelected} disabled={selectedIdx == null} className="rounded-md bg-sand p-1.5 text-ink hover:bg-sand-border disabled:opacity-40"><Trash2 size={16} /></button>
            <button type="button" onClick={clearAll} disabled={shapes.length === 0} className="rounded-md bg-sand px-2 py-1.5 text-xs font-semibold text-ink hover:bg-sand-border disabled:opacity-40">Tout effacer</button>
          </div>
        </div>

        {tool === 'select' && (
          <div className="border-b border-sand-border bg-navy-pale px-4 py-1.5 text-[11px] text-navy">
            Clique une annotation pour la selectionner, puis Supprimer (ou touche Suppr).
          </div>
        )}

        <div className="flex flex-1 items-center justify-center overflow-auto bg-sand/40 p-4">
          {loading && <div className="text-sm text-ink-muted">Chargement de la photo...</div>}
          {loadErr && <div className="text-sm text-red-600">{loadErr}</div>}
          {!loading && !loadErr && (
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="max-h-full max-w-full touch-none rounded-lg shadow-md"
              style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
            />
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-sand-border px-4 py-3">
          {hasInitial && (
            <button type="button" onClick={removeAnnotation} disabled={saving} className="rounded-md px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40">
              Retirer l annotation
            </button>
          )}
          {saveErr && <span className="text-xs text-red-600">{saveErr}</span>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-md bg-sand px-3 py-2 text-xs font-semibold text-ink hover:bg-sand-border disabled:opacity-40">Fermer</button>
            <button type="button" onClick={save} disabled={saving || loading || !!loadErr} className="rounded-md bg-navy px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40">
              {saving ? 'Enregistrement...' : 'Enregistrer l annotation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
